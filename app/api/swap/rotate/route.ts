/**
 * POST /api/swap/rotate
 * Body: { taker, from (basket id), to (basket id), attestNonUS: true, slippageBps? }
 * Returns the sells (whole balance of each `from` stock the wallet holds) plus the buy of `to`,
 * for the client to check (lib/txGuard.ts) and send as one batch. See lib/rotateQuote.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { MAX_PORT_USDC, MIN_DUST_PORT_USDC } from "@/lib/constants";
import { BASKET_IDS } from "@/lib/baskets";
import { RouteError, errText } from "@/lib/basketQuote";
import { quoteRotate } from "@/lib/rotateQuote";

export const dynamic = "force-dynamic";

const Body = z.object({
  taker: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  from: z.enum(BASKET_IDS),
  to: z.enum(BASKET_IDS),
  attestNonUS: z.literal(true),
  slippageBps: z.number().int().min(10).max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (isTradingBlocked(req.headers.get(GEO_HEADER))) {
    return NextResponse.json({ error: "geo_blocked" }, { status: 451 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const q = await quoteRotate({
      fromId: parsed.data.from,
      toId: parsed.data.to,
      taker: getAddress(parsed.data.taker),
      slippageBps: parsed.data.slippageBps,
      maxUsdc: MAX_PORT_USDC,
      minUsdc: MIN_DUST_PORT_USDC,
    });
    return NextResponse.json(q);
  } catch (e) {
    if (e instanceof RouteError) return NextResponse.json(e.body, { status: e.status });
    console.warn(`[rotate] ${errText(e)}`);
    return NextResponse.json({ error: "rotate_failed", message: (e as Error).message }, { status: 502 });
  }
}
