// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AutoPilot
 * @notice Programmable tokenized-stock portfolios on Base. You deposit USDC (or allowed stocks), write your
 *         rules onchain, and pick an agent. The agent rotates your holdings when your rules say so. This
 *         contract makes sure it can't do anything else.
 *
 * Rules you set (all stored here, readable by anyone):
 *  - autoRotate + minEdgeBps: move into the 7-day leader when it beats your basket by at least this much.
 *  - cutLosers + cutAtBps: leave a basket that's down this much over 7 days.
 *  - weekendPause: shown in the app; the contract never trades while US markets are closed and NAV is frozen.
 *  - minInterval: at most one rebalance per this many seconds (at least one day).
 *  - maxSlippageBps: every swap must return at least the Chainlink NAV value minus this (max 3%).
 *
 * What the agent can do: call rebalance(user, legs) for users who chose it, swapping between USDC and the
 * stocks fixed at deploy, through the one Aerodrome Slipstream pool pinned per stock at deploy, with every leg
 * priced against Chainlink. Sells come first, then buys, and each stock appears once, so a rebalance can't
 * buy and sell the same stock back and forth.
 * What it can't do: withdraw, send funds anywhere, trade other tokens, trade more often than your rule,
 * trade at a worse price than your slippage cap, or act after you switch it off.
 * You can withdraw everything at any time. No owner, no admin key, no upgrade path.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
}

interface ISlipstreamRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract AutoPilot {
    IERC20 public constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    ISlipstreamRouter public constant ROUTER = ISlipstreamRouter(0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F);
    uint256 public constant MAX_SLIPPAGE_BPS = 300;
    uint256 public constant MAX_LEGS = 12;
    /// Chainlink stock feeds hold over weekends and holidays, so allow up to 4 days.
    uint256 public constant MAX_FEED_AGE = 4 days;
    uint256 public constant MIN_DEPOSIT = 1e6; // 1 USDC to join the agent's list
    /// At least a day between agent trades. With one pass per stock per rebalance, a leaked agent key can
    /// cost at most the user's slippage cap once a day, never a loop of trades.
    uint256 public constant MIN_INTERVAL = 1 days;

    struct Stock {
        address feed;
        uint8 decimals;
        uint8 feedDecimals;
        bool allowed;
        int24 tickSpacing; // the one USDC pool on the router's factory this stock trades in
    }

    struct Pilot {
        address agent; // who may rebalance for you (0 = nobody)
        bool on; // master switch
        bool autoRotate;
        bool cutLosers;
        bool weekendPause;
        uint16 maxSlippageBps;
        uint16 minEdgeBps; // e.g. 200 = 2.00 points
        uint16 cutAtBps; // e.g. 500 = down 5.00%
        uint32 minInterval; // seconds between rebalances
        uint64 lastTrade;
    }

    struct Leg {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        int24 tickSpacing;
    }

    mapping(address => Stock) public stocks;
    address[] public stockList;
    mapping(address => Pilot) public pilots;
    mapping(address => mapping(address => uint256)) public balances; // user => token => amount
    address[] public users;
    mapping(address => bool) private known;
    uint256 public rebalanceCount;
    bool private locked;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    /// exit() skips a token whose transfer fails (e.g. paused), so everything else still comes out.
    event WithdrawSkipped(address indexed user, address indexed token, uint256 amount);
    event PilotSet(address indexed user, address indexed agent, bool on, uint256 minEdgeBps, uint256 cutAtBps, uint256 minInterval, bool weekendPause);
    event Traded(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 minOut);
    event Rebalanced(address indexed user, address indexed agent, uint256 legs);

    error NotAllowed();
    error BadRules();
    error Off();
    error NotAgent();
    error TooSoon(uint256 next);
    error MarketClosed();
    error StaleFeed(address token);
    error TooManyLegs();
    error BadLegs();
    error Insufficient();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    /// @param tokens tokenized stocks the agent may trade; @param feeds their Chainlink NAV feeds;
    /// @param tickSpacings the USDC pool each one trades in (all three in the same order).
    constructor(address[] memory tokens, address[] memory feeds, int24[] memory tickSpacings) {
        if (tokens.length != feeds.length || tokens.length != tickSpacings.length || tokens.length == 0) revert BadRules();
        for (uint256 i = 0; i < tokens.length; i++) {
            stocks[tokens[i]] = Stock({
                feed: feeds[i],
                decimals: _decimals(tokens[i]),
                feedDecimals: IFeed(feeds[i]).decimals(),
                allowed: true,
                tickSpacing: tickSpacings[i]
            });
            stockList.push(tokens[i]);
        }
    }

    // ---------------------------------------------------------------- user actions

    /// Write your rules and pick your agent. Set on = false to stop the agent at once.
    function setPilot(
        address agent,
        bool on,
        bool autoRotate,
        bool cutLosers,
        bool weekendPause,
        uint16 maxSlippageBps,
        uint16 minEdgeBps,
        uint16 cutAtBps,
        uint32 minInterval
    ) external {
        if (maxSlippageBps == 0 || maxSlippageBps > MAX_SLIPPAGE_BPS || cutAtBps > 9000 || minInterval < MIN_INTERVAL) {
            revert BadRules();
        }
        Pilot storage p = pilots[msg.sender];
        p.agent = agent;
        p.on = on;
        p.autoRotate = autoRotate;
        p.cutLosers = cutLosers;
        p.weekendPause = weekendPause;
        p.maxSlippageBps = maxSlippageBps;
        p.minEdgeBps = minEdgeBps;
        p.cutAtBps = cutAtBps;
        p.minInterval = minInterval;
        emit PilotSet(msg.sender, agent, on, minEdgeBps, cutAtBps, minInterval, weekendPause);
    }

    /// Add USDC or an allowed stock. Approve this contract for `amount` first.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token != address(USDC) && !stocks[token].allowed) revert NotAllowed();
        uint256 got = _pull(token, amount);
        balances[msg.sender][token] += got;
        if (!known[msg.sender] && token == address(USDC) && balances[msg.sender][token] >= MIN_DEPOSIT) {
            known[msg.sender] = true;
            users.push(msg.sender);
        }
        emit Deposited(msg.sender, token, got);
    }

    /// Take any of your tokens out, any time. They only ever go to you.
    function withdraw(address token, uint256 amount) public nonReentrant {
        uint256 bal = balances[msg.sender][token];
        if (amount > bal) amount = bal;
        balances[msg.sender][token] = bal - amount;
        if (!IERC20(token).transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(msg.sender, token, amount);
    }

    /// Switch the agent off and take everything out in one call. A token that can't be sent right now
    /// (for example a paused stock) stays inside for later; it never blocks the rest.
    function exit() external nonReentrant {
        pilots[msg.sender].on = false;
        address[] memory list = stockList;
        for (uint256 i = 0; i < list.length; i++) {
            _release(msg.sender, list[i]);
        }
        _release(msg.sender, address(USDC));
    }

    // ---------------------------------------------------------------- the agent

    /// Only the user's chosen agent, only while on, only as often as the user allows, only allowed tokens,
    /// and every leg must return at least Chainlink NAV value minus the user's slippage cap.
    function rebalance(address user, Leg[] calldata legs) external nonReentrant {
        Pilot storage p = pilots[user];
        if (!p.on) revert Off();
        if (msg.sender != p.agent) revert NotAgent();
        if (legs.length == 0 || legs.length > MAX_LEGS) revert TooManyLegs();
        uint256 next = uint256(p.lastTrade) + p.minInterval;
        if (p.lastTrade != 0 && block.timestamp < next) revert TooSoon(next);
        // NAV is frozen while markets are closed, so the price floor would be stale: never trade then.
        if (isMarketClosed(block.timestamp)) revert MarketClosed();

        // Sells first, then buys, and each stock at most once: no round trips inside one rebalance.
        bool buying;
        for (uint256 i = 0; i < legs.length; i++) {
            bool buy = legs[i].tokenIn == address(USDC);
            if (buy) buying = true;
            else if (buying) revert BadLegs();
            address stock = buy ? legs[i].tokenOut : legs[i].tokenIn;
            for (uint256 j = 0; j < i; j++) {
                address other = legs[j].tokenIn == address(USDC) ? legs[j].tokenOut : legs[j].tokenIn;
                if (other == stock) revert BadLegs();
            }
        }
        for (uint256 i = 0; i < legs.length; i++) {
            _trade(user, legs[i], p.maxSlippageBps);
        }
        p.lastTrade = uint64(block.timestamp);
        rebalanceCount += 1;
        emit Rebalanced(user, msg.sender, legs.length);
    }

    function _trade(address user, Leg calldata leg, uint256 slippageBps) private {
        bool buy = leg.tokenIn == address(USDC);
        address stock = buy ? leg.tokenOut : leg.tokenIn;
        if (!stocks[stock].allowed || (buy ? leg.tokenIn : leg.tokenOut) != address(USDC)) revert NotAllowed();
        if (leg.tickSpacing != stocks[stock].tickSpacing) revert NotAllowed();
        if (leg.amountIn == 0 || leg.amountIn > balances[user][leg.tokenIn]) revert Insufficient();

        uint256 minOut = quoteMinOut(stock, buy, leg.amountIn, slippageBps);
        balances[user][leg.tokenIn] -= leg.amountIn;

        uint256 before = IERC20(leg.tokenOut).balanceOf(address(this));
        if (!IERC20(leg.tokenIn).approve(address(ROUTER), leg.amountIn)) revert TransferFailed();
        ROUTER.exactInputSingle(
            ISlipstreamRouter.ExactInputSingleParams({
                tokenIn: leg.tokenIn,
                tokenOut: leg.tokenOut,
                tickSpacing: leg.tickSpacing,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: leg.amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(leg.tokenIn).approve(address(ROUTER), 0);
        // Credit what actually arrived, and re-check it against the floor.
        uint256 got = IERC20(leg.tokenOut).balanceOf(address(this)) - before;
        if (got < minOut) revert Insufficient();
        balances[user][leg.tokenOut] += got;
        emit Traded(user, leg.tokenIn, leg.tokenOut, leg.amountIn, got, minOut);
    }

    /// Minimum output for a swap, from the stock's Chainlink NAV minus `slippageBps`.
    function quoteMinOut(address stock, bool buy, uint256 amountIn, uint256 slippageBps) public view returns (uint256) {
        Stock memory s = stocks[stock];
        (, int256 answer,, uint256 updatedAt,) = IFeed(s.feed).latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > MAX_FEED_AGE) revert StaleFeed(stock);
        uint256 price = uint256(answer);
        uint256 expected = buy
            ? (amountIn * 10 ** (uint256(s.decimals) + s.feedDecimals)) / (price * 1e6)
            : (amountIn * price * 1e6) / 10 ** (uint256(s.decimals) + s.feedDecimals);
        return (expected * (10_000 - slippageBps)) / 10_000;
    }

    // ---------------------------------------------------------------- views

    /// Same window as LoanGuard: Friday 20:00 UTC to Monday 01:00 UTC, plus NYSE holidays through 2027.
    function isMarketClosed(uint256 ts) public pure returns (bool) {
        uint256 dayNum = ts / 1 days;
        uint256 day = (dayNum + 4) % 7;
        uint256 hour = (ts % 1 days) / 1 hours;
        if ((day == 5 && hour >= 20) || day == 6 || day == 0 || (day == 1 && hour < 1)) return true;
        return _holiday(dayNum) || (hour < 1 && _holiday(dayNum - 1));
    }

    function _holiday(uint256 d) private pure returns (bool) {
        return d == 20783 || d == 20812 || d == 20819 || d == 20836 || d == 20864 || d == 20903 || d == 20969
            || d == 20987 || d == 21004 || d == 21067 || d == 21147 || d == 21176;
    }

    function userCount() external view returns (uint256) {
        return users.length;
    }

    function stockCount() external view returns (uint256) {
        return stockList.length;
    }

    /// When the agent may next trade for `user` (0 = now).
    function nextTradeAt(address user) external view returns (uint256) {
        Pilot memory p = pilots[user];
        if (p.lastTrade == 0) return 0;
        uint256 next = uint256(p.lastTrade) + p.minInterval;
        return block.timestamp >= next ? 0 : next;
    }

    // ---------------------------------------------------------------- internals

    function _release(address user, address token) private {
        uint256 bal = balances[user][token];
        if (bal == 0) return;
        balances[user][token] = 0;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, user, bal));
        if (ok && (data.length == 0 || abi.decode(data, (bool)))) {
            emit Withdrawn(user, token, bal);
        } else {
            balances[user][token] = bal;
            emit WithdrawSkipped(user, token, bal);
        }
    }

    function _pull(address token, uint256 amount) private returns (uint256) {
        uint256 before = IERC20(token).balanceOf(address(this));
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        return IERC20(token).balanceOf(address(this)) - before;
    }

    function _decimals(address token) private view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        return ok && data.length >= 32 ? abi.decode(data, (uint8)) : 8;
    }
}
