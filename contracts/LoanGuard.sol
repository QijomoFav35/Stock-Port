// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LoanGuard
 * @notice Liquidation shield for stock-backed USDC loans on Aave V4 (Base, "Coinbase Stocks" Spoke).
 *
 * A user parks a USDC reserve here and picks a trigger health factor. When their Aave health
 * falls below the trigger, anyone (our keeper, a Bankr agent, the user) can call `protect(user)`.
 * The contract pays down just enough of the user's USDC debt to bring health back to their target,
 * using only that user's reserve, through Aave's own Giver position manager.
 *
 * Weekend shield: Aave's stock prices come from Chainlink feeds that update 24/5, so a gap at the
 * Monday open can liquidate a loan with no warning. Users can set a higher weekend trigger that
 * applies from Friday 20:00 UTC to Sunday 23:00 UTC, so the guard tops up before the open.
 *
 * What this contract can do with your money: repay YOUR Aave USDC debt, or send your reserve back
 * to YOU. Nothing else. It never touches your stock collateral, holds no admin keys, and has no
 * upgrade path or owner.
 *
 * One-time setup for a user: on the Spoke, call setUserPositionManager(GIVER, true) so the Giver
 * may repay on their behalf (the Giver only ever adds funds to a position).
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface ISpoke {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 riskPremium,
            uint256 avgCollateralFactor,
            uint256 healthFactor,
            uint256 totalCollateralValue,
            uint256 totalDebtValueRay,
            uint256 activeCollateralCount,
            uint256 borrowCount
        );
    function getUserTotalDebt(uint256 reserveId, address user) external view returns (uint256);
    function isPositionManager(address user, address manager) external view returns (bool);
}

interface IGiverPositionManager {
    function repayOnBehalfOf(address spoke, uint256 reserveId, uint256 amount, address onBehalfOf) external;
}

contract LoanGuard {
    // --- Base mainnet, Aave V4 Equities Hub (verified onchain 2026-11-25) ---
    IERC20 public constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    ISpoke public constant SPOKE = ISpoke(0x17905Db0e4A3514467539956c084180616AE7B8D);
    IGiverPositionManager public constant GIVER = IGiverPositionManager(0x9E81c2fDE4E34CAB3AB1667ca3c932dBAED95F08);
    uint256 public constant USDC_RESERVE_ID = 7;

    uint256 private constant WAD = 1e18;
    uint256 private constant RAY = 1e27;
    /// Account values are USD scaled by 1e26; USDC has 6 decimals.
    uint256 private constant VALUE_TO_USDC = 1e20;
    /// Repay 1% extra so a USDC price a hair under $1 or a little interest doesn't leave us short of target.
    uint256 private constant REPAY_BUFFER_BPS = 100;

    uint256 public constant MIN_TRIGGER = 1.02e18;
    uint256 public constant MAX_TARGET = 3e18;

    struct Guard {
        uint128 reserve; // USDC (6 decimals) parked for this user
        uint64 trigger; // health factor (1e18) below which protect() may act
        uint64 target; // health factor (1e18) protect() restores
        uint64 weekendTrigger; // trigger used over the weekend window (0 = same as trigger)
        uint64 lastProtect; // timestamp of the last top-up
    }

    mapping(address => Guard) public guards;
    bool private locked;

    event Funded(address indexed user, uint256 amount, uint256 reserve);
    event Withdrawn(address indexed user, uint256 amount, uint256 reserve);
    event Configured(address indexed user, uint256 trigger, uint256 target, uint256 weekendTrigger);
    event Protected(address indexed user, address indexed caller, uint256 repaid, uint256 healthBefore, uint256 healthAfter, bool weekend);

    error BadConfig();
    error NotArmed();
    error Healthy(uint256 health, uint256 trigger);
    error NoReserve();
    error ManagerNotApproved();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    // ---------------------------------------------------------------- user actions

    /// Set (or change) your trigger, target and weekend trigger. Health factors use 1e18 = 1.00.
    function configure(uint256 trigger, uint256 target, uint256 weekendTrigger) external {
        if (trigger < MIN_TRIGGER || target <= trigger || target > MAX_TARGET) revert BadConfig();
        if (weekendTrigger != 0 && (weekendTrigger < trigger || weekendTrigger >= target)) revert BadConfig();
        Guard storage g = guards[msg.sender];
        g.trigger = uint64(trigger);
        g.target = uint64(target);
        g.weekendTrigger = uint64(weekendTrigger);
        emit Configured(msg.sender, trigger, target, weekendTrigger);
    }

    /// Add USDC to your reserve. Approve this contract for `amount` first.
    function fund(uint256 amount) external nonReentrant {
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        Guard storage g = guards[msg.sender];
        g.reserve = uint128(uint256(g.reserve) + amount);
        emit Funded(msg.sender, amount, g.reserve);
    }

    /// Take USDC back out of your reserve, any time. It only ever goes to you.
    function withdraw(uint256 amount) external nonReentrant {
        Guard storage g = guards[msg.sender];
        if (amount > g.reserve) amount = g.reserve;
        g.reserve = uint128(uint256(g.reserve) - amount);
        if (!USDC.transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(msg.sender, amount, g.reserve);
    }

    // ---------------------------------------------------------------- the guard

    /// True from Friday 20:00 UTC to Sunday 23:00 UTC, when stock price feeds are closed.
    function isWeekendWindow(uint256 ts) public pure returns (bool) {
        uint256 day = (ts / 1 days + 4) % 7; // 0 = Sunday, 5 = Friday, 6 = Saturday
        uint256 hour = (ts % 1 days) / 1 hours;
        return (day == 5 && hour >= 20) || day == 6 || (day == 0 && hour < 23);
    }

    /// The trigger that applies right now for `user`.
    function activeTrigger(address user) public view returns (uint256 trigger, bool weekend) {
        Guard memory g = guards[user];
        weekend = isWeekendWindow(block.timestamp) && g.weekendTrigger != 0;
        trigger = weekend ? g.weekendTrigger : g.trigger;
    }

    /// USDC (6 decimals) needed to bring `user` back to their target health, capped by debt and reserve.
    function repayNeeded(address user) public view returns (uint256 amount, uint256 health) {
        Guard memory g = guards[user];
        (, uint256 avgCf, uint256 hf, uint256 collValue, uint256 debtRay,,) = SPOKE.getUserAccountData(user);
        health = hf;
        uint256 debtValue = debtRay / RAY; // USD * 1e26
        if (debtValue == 0 || g.target == 0) return (0, health);
        uint256 weighted = (collValue * avgCf) / WAD; // USD * 1e26
        uint256 maxDebtAtTarget = (weighted * WAD) / g.target;
        if (debtValue <= maxDebtAtTarget) return (0, health);
        amount = ((debtValue - maxDebtAtTarget) / VALUE_TO_USDC) * (10_000 + REPAY_BUFFER_BPS) / 10_000;
        // The Giver can repay the drawn debt but not the premium part, so stay a little under the total
        // (simulated on Base 2026-11-25: max accepted was ~99.98% of getUserTotalDebt).
        uint256 debt = (SPOKE.getUserTotalDebt(USDC_RESERVE_ID, user) * 99) / 100;
        if (amount > debt) amount = debt;
        if (amount > g.reserve) amount = g.reserve;
    }

    /// Anyone may call this. It only acts when the user's health is under their trigger, and only
    /// spends that user's reserve to repay that user's debt.
    function protect(address user) external nonReentrant returns (uint256 repaid) {
        Guard storage g = guards[user];
        if (g.trigger == 0) revert NotArmed();
        (uint256 trigger, bool weekend) = activeTrigger(user);
        (uint256 amount, uint256 healthBefore) = repayNeeded(user);
        if (healthBefore >= trigger) revert Healthy(healthBefore, trigger);
        if (amount == 0) revert NoReserve();
        if (!SPOKE.isPositionManager(user, address(GIVER))) revert ManagerNotApproved();

        uint256 balBefore = _usdcBalance();
        if (!USDC.approve(address(GIVER), amount)) revert TransferFailed();
        GIVER.repayOnBehalfOf(address(SPOKE), USDC_RESERVE_ID, amount, user);
        USDC.approve(address(GIVER), 0);
        // Charge the reserve only for what Aave actually took.
        repaid = balBefore - _usdcBalance();
        if (repaid > amount) revert TransferFailed();
        g.reserve = uint128(uint256(g.reserve) - repaid);
        g.lastProtect = uint64(block.timestamp);

        (,, uint256 healthAfter,,,,) = SPOKE.getUserAccountData(user);
        emit Protected(user, msg.sender, repaid, healthBefore, healthAfter, weekend);
    }

    function _usdcBalance() private view returns (uint256) {
        return IERC20Balance(address(USDC)).balanceOf(address(this));
    }

    /// Keeper helper: should protect(user) run right now?
    function check(address user) external view returns (bool needed, uint256 health, uint256 trigger, uint256 amount) {
        if (guards[user].trigger == 0) return (false, 0, 0, 0);
        (trigger,) = activeTrigger(user);
        (amount, health) = repayNeeded(user);
        needed = health < trigger && amount > 0 && SPOKE.isPositionManager(user, address(GIVER));
    }
}
