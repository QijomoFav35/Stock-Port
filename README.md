# Stock Port

Borrow USDC against your tokenized stocks on Base, and let agents protect and rotate your bag inside rules you set onchain.

- **Borrow:** deposit NVDAc, AAPLc, MSFTc, GOOGLc, AMZNc, METAc, TSLAc or SPCXc on Aave V4 and borrow USDC in one tx.
- **Loan Guard:** you fund a USDC reserve and set your triggers. The Guard Agent watches every Aave V4 stock loan, projects
  health at the Monday open from live pool prices, and calls `protect()` to repay before liquidation. A higher trigger
  applies from Friday 20:00 UTC to Monday 01:00 UTC and on NYSE holidays, when NAV is frozen.
- **AutoPilot:** program your bag (rotate into the 7-day leader, cut losers, at most one move every N days). In Tap mode
  you approve each move. In Auto mode an agent trades your deposit inside limits the contract enforces.
- **Baskets:** buy Mag 7, AI Bubble, IPO Szn, Port Elon or Crypto Bros from $5, or rotate between them in one tx.
- **/stats:** every Stock Port tx, found onchain by its ERC-8021 Builder Code. Don't trust, verify.

Not available in the US, UK or other restricted regions. Tokenized stocks track a reference price and grant no
shareholder rights.

## Contracts

Both have no owner, no admin key and no upgrade path.

| Contract | What it enforces |
| --- | --- |
| `contracts/LoanGuard.sol` | Anyone can call `protect(user)`, but it only repays that user's Aave V4 debt from their own reserve, only below their trigger, only up to their target health. Withdraw anytime. |
| `contracts/AutoPilot.sol` | Only the agent you pick can trade, only USDC to the stocks fixed at deploy and back, one pinned pool per stock, sells then buys with each stock once, at most one rebalance per day (or your interval), never while markets are closed, every swap within your slippage cap (max 3%) of Chainlink NAV. `exit()` returns everything. |

Simulations against live Base state (no deploy, no funds):

```bash
npm run guard:build && npm run guard:sim
npm run autopilot:build && npm run autopilot:sim
```

## Safety in the app

- `lib/txGuard.ts`: every call is checked before the wallet opens. Exact approvals only (never infinite), known contracts
  only, Aerodrome buys must pay out to your wallet with a Chainlink-based minimum.
- `lib/peg.ts`, `lib/pegHealth.ts`: buys pause when a pool trades more than 2% off its Chainlink NAV.
- `lib/sponsorPolicy.ts`: gas sponsorship only for calls into Stock Port's own routes, with gas caps.
- `middleware.ts`, `lib/geo.ts`, `lib/rateLimit.ts`: country check on every request, per-IP rate limits.
- `/api/rpc`: read-only RPC proxy, so the RPC key never reaches the browser.
- Swaps use Aerodrome Slipstream directly. o1 and 0x routes are off unless `NEXT_PUBLIC_ENABLE_AGGREGATOR_ROUTES=1`.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Deploy and rollback steps, env vars and cron jobs: `docs/LAUNCH.md`.
