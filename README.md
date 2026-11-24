# Stock Port (Phase 1)

Base mainnet app: port USDC into the Port Agent's 3-stock tokenized basket in one tap.

## Run

```bash
cp .env.example .env.local   # fill in NEXT_PUBLIC_BASE_BUILDER_CODE and ZEROX_API_KEY at minimum
npm install
npm run dev
GEO_OVERRIDE_COUNTRY=US npm run dev   # test the US block locally
npm run check-routes                  # can o1 and 0x each buy every basket stock? (nothing is sent)
```

## What's here

| File | What it does |
| --- | --- |
| `middleware.ts`, `lib/geo.ts` | 451 on `/api/swap*` for US, US territories, CU/IR/KP/SY. Other pages stay open with `x-geo-blocked` header + cookie. Fails closed in production if the country header is missing. |
| `lib/attribution.ts` | ERC-8021 Builder Code suffix via `ox/erc8021`. `requireDataSuffix()` refuses to send if the code isn't set. |
| `lib/tokenizedStocks.ts` | Coinbase Tokenized Stocks API client (list w/ pagination, chains, metadata, total-supply), zod-validated. B20 ABI + `readShares()` using `scaledBalanceOf`. |
| `lib/o1.ts`, `lib/zeroEx.ts`, `app/api/swap/quote/route.ts` | **o1 Exchange** (`POST /api/v2/order`) creates one buy order per basket leg, proxied server-side with `O1_API_KEY`. If o1 fails, the whole basket is re-quoted through 0x automatically (response carries `fallback`). `SWAP_PROVIDER=0x` flips the default. Requires `attestNonUS: true`, $5 to MAX cap, re-checks geo server-side. |
| `hooks/usePortBundle.ts` | Signs any o1 Permit2 payloads and splices the signature over o1's placeholder, then EIP-5792 `sendCalls` (atomic) when the wallet supports it, else sequential `sendTransaction`. Builder Code on every call either way. Skips approve if allowance already covers it. |
| `lib/wagmi.ts`, `app/providers.tsx`, `components/Navbar.tsx` | wagmi config (Base Account + injected connectors), Wagmi → React Query providers, and a small wagmi `ConnectButton` (navbar + Port card). OnchainKit was removed: Base deprecated it and recommends wagmi + viem directly (docs.base.org/onchainkit). |
| `app/dust`, `components/DustCard.tsx`, `hooks/useDustSweep.ts`, `app/api/swap/dust/*`, `lib/alchemy.ts` | **Dust to Stocks.** Scans the wallet with Alchemy (balances + prices, unpriced tokens hidden), quotes each token → USDC on 0x, skips tokens over 10% price impact or $0.10 gas (Rabby's guards), sweeps in one EIP-5792 batch or token by token, then ports the USDC that arrived into the basket (min $1). Needs `ALCHEMY_API_KEY` and `ZEROX_API_KEY`. |
| `components/PortCard.tsx`, `app/page.tsx` | Basket with NAV ref price, amount, non-US checkbox, Basescan links. |

## Corrections vs. the original brief (from official docs, 2026-11-22)

- **Tickers use a `c` suffix** (`TSLAc`, `AMDc`, `GOOGLc`), not `x`. `NVDAx` style is a different issuer. Default basket is `NVDAc / GOOGLc / METAc`: NVDAc carried ~57% of early DEX volume, and BaseStonk's docs list exactly these plus AAPLc as the tickers with live USDC pools. TSLAc is reported as deep in one source but "no on-chain market" in another, so it's left out.
- **`nav_price` is a Chainlink total-return reference, not an execution price**, and can be hours/days stale. Some tokens have no `nav_price`.
- **B20 shares** = `raw * multiplier / 1e18` = `scaledBalanceOf(account)`. Return types assumed `uint256` (docs print selectors only).
- Transfers can be blocked by the policy registry (reverts). Holding and secondary trading are described as permissionless.
- The official rules text doesn't itself mandate a US block or Builder Codes; the Tokenized Stocks docs say the tokens are only for persons outside the US and integrators must apply restrictions. We keep both rules anyway.
- Rules say testnet submissions "will not be judged less favorably", but traction is still verified onchain, so mainnet stays the plan.

## o1 integration notes (from docs.o1.exchange/api/trading, 2026-11-22)

- `transactions[].unsigned` is documented as a JSON object `{to, data, value, gasLimit, chainId}`, not RLP hex. `lib/o1.ts` handles both.
- o1's documented flow is: sign raw tx → `POST /api/v2/order/complete`. Browser wallets can't `eth_signTransaction` (MetaMask refuses, smart wallets can't at all), so **the user's wallet broadcasts the calls itself** and we skip `/complete`. Ask o1 whether volume sent this way counts for their prize.
- `uiAmount` for a USDC-quoted buy is assumed to be USDC spent (docs only say "human-readable"). Verify with $5.
- Permit2: we approve USDC to the canonical Permit2 contract if o1 returns a Permit2 payload (docs don't say an approve is needed). Smart-wallet signatures don't fit o1's 65-byte placeholder, so Permit2 legs currently need an EOA wallet.
- No o1 support for ERC-8021 is documented; our Builder Code is appended by the client either way.

## Known gaps

- **wagmi is pinned to 2.x** (picked for OnchainKit, since removed). Moving to wagmi 3 is optional later. No Basename display yet.
- **o1 Permit2 legs + Base Account:** smart wallet signatures don't fit o1's 65-byte Permit2 placeholder. The client routes deployed smart wallets through 0x up front, and retries through 0x if a wallet returns a long signature. That volume doesn't count toward o1 until o1 confirms how smart wallets should sign.
- **Liquidity is reported, not tested.** Aerodrome is the main venue per Base; 0x, 1inch, KyberSwap and CoW integrated at launch. Run `npm run check-routes` with real keys before launch. Reported pool depth (Sept 23 2026, Aerodrome Slipstream stock/USDC): NVDAc ~$2.11M, METAc ~$2.10M, GOOGLc ~$1.66M.
- Quotes and the Tokenized Stocks API couldn't be called from the build sandbox (network blocked), so live responses are untested.
- `/api/stats` logging, Supabase, dust rehab and Bankr are Phase 2/3.
