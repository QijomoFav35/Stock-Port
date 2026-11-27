/**
 * POST /api/swap/quote
 * Body: { taker, usdcAmount (decimal string, e.g. "10"), attestNonUS: true, slippageBps?, provider?, purpose?, basketId?, stock? }
 * Returns the swap calls that buy the chosen basket (lib/baskets.ts) at its weights. Quoting, provider
 * fallback and the NAV drift guard live in lib/basketQuote.ts.
 * Geo: middleware.ts returns 451 for blocked countries. We re-check here (defense in depth).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAddress, parseUnits } from "viem";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { MAX_PORT_USDC, MIN_DUST_PORT_USDC, MIN_PORT_USDC, USDC_DECIMALS } from "@/lib/constants";
import { BASKET_IDS, getBasket } from "@/lib/baskets";
import { RouteError, quoteBasketBuy } from "@/lib/basketQuote";
import { STOCK_RESERVES } from "@/lib/aave";
import { logAndMask } from "@/lib/safeError";

export type { PortCall, PortQuote } from "@/lib/basketQuote";

export const dynamic = "force-dynamic";

const Body = z.object({
  taker: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  usdcAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  attestNonUS: z.literal(true),
  slippageBps: z.number().int().min(10).max(500).optional(),
  provider: z.enum(["aerodrome", "o1", "0x"]).optional(),
  purpose: z.enum(["port", "dust"]).optional(),
  basketId: z.enum(BASKET_IDS).optional(),
  /** Buy one stock instead of a basket (used by Buy and borrow). Must be an Aave V4 collateral stock. */
  stock: z.enum(STOCK_RESERVES.map((r) => r.symbol) as [string, ...string[]]).optional(),
});

export async function POST(req: NextRequest) {
  if (isTradingBlocked(req.headers.get(GEO_HEADER))) {
    return NextResponse.json({ error: "geo_blocked" }, { status: 451 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { usdcAmount, slippageBps, provider, purpose, basketId, stock } = parsed.data;
  const amt = Number(usdcAmount);
  const min = purpose === "dust" ? MIN_DUST_PORT_USDC : MIN_PORT_USDC;
  if (amt < min || amt > MAX_PORT_USDC) {
    return NextResponse.json({ error: "amount_out_of_range", min, max: MAX_PORT_USDC }, { status: 400 });
  }
  try {
    const quote = await quoteBasketBuy({
      legs: stock ? [{ symbol: stock, weightBps: 10_000 }] : getBasket(basketId).legs,
      total: parseUnits(usdcAmount, USDC_DECIMALS),
      taker: getAddress(parsed.data.taker),
      slippageBps,
      forced: provider,
    });
    return NextResponse.json(quote);
  } catch (e) {
    if (e instanceof RouteError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "quote_failed", message: logAndMask("quote", e) }, { status: 502 });
  }
}
