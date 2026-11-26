# Launch and rollback runbook

## Before every deploy
1. `npm run typecheck && npm run lint && npm run build` pass locally.
2. `git status` is clean and `.env.local` is not tracked (`git ls-files | grep env` shows only `.env.example`).
3. Tag the commit you are about to ship: `git tag release-YYYY-MM-DD && git push origin --tags`.

## Render environment (Dashboard → your service → Environment)
Server only: `BASE_RPC_URL`, `ZEROX_API_KEY`, `O1_API_KEY`, `IPINFO_TOKEN`, `GEO_SOURCE=ipinfo`,
`STATS_FROM_BLOCK` (launch block, for /stats), `CDP_PAYMASTER_URL` (optional), `FEEDBACK_WEBHOOK_URL` (optional), `KEEPER_PRIVATE_KEY`, `KEEPER_CRON_SECRET`, `AUTOPILOT_AGENT_KEY` (its own wallet, never the keeper key), `BANKR_API_KEY` (later).

Public: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_BUILDER_CODE`, `NEXT_PUBLIC_LOAN_GUARD_ADDRESS`,
`NEXT_PUBLIC_LOAN_GUARD_FROM_BLOCK`, `NEXT_PUBLIC_AUTOPILOT_ADDRESS`, `NEXT_PUBLIC_AUTOPILOT_FROM_BLOCK`, analytics ids. Never set `NEXT_PUBLIC_GUARD_PREVIEW` on Render.

Rule: anything starting with `NEXT_PUBLIC_` ends up in the browser. Keys never get that prefix.

If you use the CDP paymaster, set its contract allowlist and per-user limits in the CDP dashboard, so nobody can spend your
gas credits on other contracts.

## After every deploy (5 minutes)
- `/api/geo` shows your country and `tradingBlocked: false` (and `true` from a US VPN).
- Faked IP test: `curl -s -H "x-forwarded-for: 8.8.8.8" -H "cf-connecting-ip: 8.8.8.8" -H "x-real-ip: 8.8.8.8" -H "true-client-ip: 8.8.8.8" https://YOUR-SITE/api/geo`
  must still show your own country, not `US`. The app trusts only the last x-forwarded-for entry (added by Render's
  proxy). If it shows `US`, set `CLIENT_IP_HEADER` on Render to the header that Render itself sets, redeploy and test again.
- Home, /borrow, /baskets, /stats, /next and /privacy load on desktop and on a phone.
- Browser devtools → Network: no request contains your Alchemy key (browser reads go to `/api/rpc`).
- `/robots.txt` and `/sitemap.xml` show the live domain.
- One small real tx (e.g. a $5 basket), then check it on Basescan and with the Builder Code checker.

## Rollback
- **Site:** Render Dashboard → service → Events → pick the last good deploy → "Rollback". Takes about a minute and keeps
  env vars. Or redeploy a tag: `git checkout release-YYYY-MM-DD` and push it to the deploy branch.
- **A bad env var:** fix it in Environment, then "Save, rebuild and deploy". `NEXT_PUBLIC_*` values only change after a rebuild.
- **Loan Guard contract:** it has no owner and can't be paused or upgraded. To stop new sign-ups, remove
  `NEXT_PUBLIC_LOAN_GUARD_ADDRESS` and redeploy: the card shows "Launching soon" and the keeper stops. Users can always call
  `withdraw` on the contract from Basescan to take their reserve back.
- **AutoPilot contract:** no owner, no pause. Each user can switch their agent off (`setPilot` with on = false) or call `exit()`
  on Basescan at any time. To stop new sign-ups, remove `NEXT_PUBLIC_AUTOPILOT_ADDRESS` and redeploy.
- **Keeper or AutoPilot agent misbehaving:** pause its Render cron job (`/api/guard/keeper` or `/api/autopilot/run`). The
  contracts cap what a bad agent key can do: one rebalance per user interval (at least a day), each stock once per
  rebalance in its pinned pool, USDC to allowed stocks and back only, never while markets are closed, and every swap within
  the user's slippage cap of Chainlink NAV. Rotate the key and users keep their funds.
- **A leaked key:** rotate it at the provider first, then update Render and `.env.local`, then redeploy.

## Cron jobs (Render → New → Cron Job, every 5 minutes)
Both send `Authorization: Bearer $KEEPER_CRON_SECRET`:
- `curl -s -X POST -H "Authorization: Bearer $KEEPER_CRON_SECRET" https://YOUR-SITE/api/guard/keeper`
- `curl -s -X POST -H "Authorization: Bearer $KEEPER_CRON_SECRET" https://YOUR-SITE/api/autopilot/run`

## Data and backups
There is no database and no user accounts. All state is onchain (Aave, LoanGuard, token balances) or in the git repo, so
backups are GitHub plus your local clone. Keep a copy of `.env.local` in a password manager: it is the only copy of your keys.

## Limits worth knowing
- API rate limits live in `lib/rateLimit.ts` and are per server instance. Before running more than one Render instance,
  move them to a shared store (e.g. Upstash Redis).
- Errors sent to the browser are cleaned by `lib/safeError.ts`. Full errors only go to the Render logs.
