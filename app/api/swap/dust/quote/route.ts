/**
 * POST /api/swap/dust/quote
 * Body: { taker, attestNonUS: true, tokens: [{ token, raw, valueUsd }] }
 *
 * Quotes each dust token → USDC through 0x (best long-tail coverage). A token is skipped, not the
 * whole sweep, when: no route, the swap would lose more than DUST_MAX_IMPACT_BPS of its value, or
 * gas costs more than DUST_MAX_GAS_USD (same guards as Rabby's Convert Dust).
 * The client appends the Builder Code to every call at send time.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAddress, type Address, type Hex } from "viem";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { DUST_MAX_GAS_USD, DUST_MAX_IMPACT_BPS, DUST_MAX_TOKENS, USDC_BASE, USDC_DECIMALS } from "@/lib/constants";
import { getZeroExQuote } from "@/lib/zeroEx";
import { getUsdPrices } from "@/lib/alchemy";
import { publicMessage } from "@/lib/safeError";

export const dynamic = "force-dynamic";

const WETH_BASE: Address = "0x4200000000000000000000000000000000000006";
const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const Body = z.object({
  taker: addr,
  attestNonUS: z.literal(true),
  slippageBps: z.number().int().min(10).max(500).optional(),
  tokens: z
    .array(z.object({ token: addr, raw: z.string().regex(/^\d+$/), valueUsd: z.number().nonnegative() }))
    .min(1)
    .max(DUST_MAX_TOKENS),
});

export type DustLeg = {
  token: Address;
  sellAmount: string;
  spender: Address;
  call: { to: Address; data: Hex; value: Hex };
  buyUsdc: string;
  minBuyUsdc: string;
};
export type DustSkip = { token: Address; reason: "no_route" | "price_impact" | "gas_too_high" | "quote_failed"; detail?: string };
export type DustQuote = { legs: DustLeg[]; skipped: DustSkip[]; minTotalUsdc: string; expiresAt: number };

export async function POST(req: NextRequest) {
  if (isTradingBlocked(req.headers.get(GEO_HEADER))) {
    return NextResponse.json({ error: "geo_blocked" }, { status: 451 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const taker = getAddress(parsed.data.taker);
  const slippageBps = parsed.data.slippageBps ?? Math.round(DUST_MAX_IMPACT_BPS / 2); // Rabby: half the cap is slippage

  const ethUsd = await getUsdPrices([WETH_BASE])
    .then((m) => m.get(WETH_BASE))
    .catch(() => undefined);

  const results = await Promise.all(
    parsed.data.tokens.map(async (t): Promise<DustLeg | DustSkip> => {
      const token = getAddress(t.token);
      try {
        const q = await getZeroExQuote({ sellToken: token, buyToken: USDC_BASE, sellAmount: BigInt(t.raw), taker, slippageBps });
        if (!q.liquidityAvailable || !q.transaction?.data) return { token, reason: "no_route" };

        const outUsd = Number(q.buyAmount) / 10 ** USDC_DECIMALS;
        if (t.valueUsd > 0 && outUsd < t.valueUsd * (1 - DUST_MAX_IMPACT_BPS / 10_000)) {
          return { token, reason: "price_impact", detail: `$${t.valueUsd.toFixed(2)} in, $${outUsd.toFixed(2)} out` };
        }
        if (ethUsd && q.transaction.gas && q.transaction.gasPrice) {
          const gasUsd = (Number(q.transaction.gas) * Number(q.transaction.gasPrice) * ethUsd) / 1e18;
          if (gasUsd > DUST_MAX_GAS_USD) return { token, reason: "gas_too_high", detail: `~$${gasUsd.toFixed(3)} gas` };
        }
        const spender = getAddress(q.transaction.to);
        return {
          token,
          sellAmount: t.raw,
          spender,
          call: { to: spender, data: q.transaction.data, value: ("0x" + BigInt(q.transaction.value || "0").toString(16)) as Hex },
          buyUsdc: q.buyAmount,
          minBuyUsdc: q.minBuyAmount,
        };
      } catch (e) {
        return { token, reason: "quote_failed", detail: publicMessage(e).slice(0, 160) };
      }
    }),
  );

  const legs = results.filter((r): r is DustLeg => "call" in r);
  const skipped = results.filter((r): r is DustSkip => "reason" in r);
  const minTotal = legs.reduce((s, l) => s + BigInt(l.minBuyUsdc), 0n);
  return NextResponse.json({
    legs,
    skipped,
    minTotalUsdc: minTotal.toString(),
    expiresAt: Date.now() + 30_000,
  } satisfies DustQuote);
}
