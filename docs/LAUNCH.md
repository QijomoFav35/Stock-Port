# Launch and rollback runbook

## Before every deploy
1. `npm run typecheck && npm run lint && npm run build` pass locally.
2. `git status` is clean and `.env.local` is not tracked (`git ls-files | grep env` shows only `.env.example`).
3. Tag the commit you are about to ship: `git tag release-YYYY-MM-DD && git push origin --tags`.

## Render environment (Dashboard → your service → Environment)
Server only: `BASE_RPC_URL`, `ALCHEMY_API_KEY`, `ZEROX_API_KEY`, `O1_API_KEY`, `IPINFO_TOKEN`, `GEO_SOURCE=ipinfo`,
`CDP_PAYMASTER_URL` (optional), `KEEPER_PRIVATE_KEY`, `KEEPER_CRON_SECRET`, `BANKR_API_KEY` (later).

Public: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_BUILDER_CODE`, `NEXT_PUBLIC_LOAN_GUARD_ADDRESS`,
`NEXT_PUBLIC_LOAN_GUARD_FROM_BLOCK`, `NEXT_PUBLIC_CONTACT_X`, analytics ids. Never set `NEXT_PUBLIC_GUARD_PREVIEW` on Render.

Rule: anything starting with `NEXT_PUBLIC_` ends up in the browser. Keys never get that prefix.

If you use the CDP paymaster, set its contract allowlist and per-user limits in the CDP dashboard, so nobody can spend your
gas credits on other contracts.

## After every deploy (5 minutes)
- `/api/geo` shows your country and `tradingBlocked: false` (and `true` from a US VPN).
- Home, /borrow, /baskets, /sweep, /race, /next and /privacy load on desktop and on a phone.
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
- **Keeper misbehaving:** pause the Render cron job. Nothing else depends on it.
- **A leaked key:** rotate it at the provider first, then update Render and `.env.local`, then redeploy.

## Data and backups
There is no database and no user accounts. All state is onchain (Aave, LoanGuard, token balances) or in the git repo, so
backups are GitHub plus your local clone. Keep a copy of `.env.local` in a password manager: it is the only copy of your keys.

## Limits worth knowing
- API rate limits live in `lib/rateLimit.ts` and are per server instance. Before running more than one Render instance,
  move them to a shared store (e.g. Upstash Redis).
- Errors sent to the browser are cleaned by `lib/safeError.ts`. Full errors only go to the Render logs.
