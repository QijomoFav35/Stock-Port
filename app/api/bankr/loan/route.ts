/**
 * GET /api/bankr/loan?wallet=0x…&action=borrow|topup|repay|status&stock=NVDAc&deposit=0.05&usdc=10
 *
 * For agents like Bankr ("Borrow from X"): returns the exact Aave V4 txs for that wallet, each as
 * { to, data, value, chainId } with the Stock Port Builder Code, plus a plain-English summary and health.
 * Read-only: it signs and sends nothing. The wallet's own agent submits the txs in order.
 * Region: the caller here is Bankr's server, not the user, so its IP says nothing about where the user is.
 * Bankr runs its own one-time location check and blocks the US and UK for tokenized stocks.
 * The read-only plan is not geo-gated for that reason; a browser in a blocked region still gets 451.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { PlanError, buildLoanPlan } from "@/lib/loanPlan";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

const Query = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  action: z.enum(["borrow", "topup", "repay", "status"]),
  stock: z.string().regex(/^[A-Za-z]{2,8}c?$/).optional(),
  deposit: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  usdc: z.string().regex(/^(all|\d+(\.\d{1,6})?)$/i).optional(),
});

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function GET(req: NextRequest) {
  // A browser (it sends sec-fetch-mode) in a blocked region is refused like any trade route.
  if (isTradingBlocked(req.headers.get(GEO_HEADER)) && req.headers.get("sec-fetch-mode")) {
    return NextResponse.json({ ok: false, error: "geo_blocked", message: "Not available in the US, UK or other restricted regions." }, { status: 451, headers: CORS });
  }
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "Use ?wallet=0x…&action=borrow|topup|repay|status&stock=NVDAc&deposit=0.05&usdc=10" },
      { status: 400, headers: CORS },
    );
  }
  const q = parsed.data;
  const stock = q.stock ? q.stock.toUpperCase().replace(/C$/, "") + "c" : undefined;
  try {
    const plan = await buildLoanPlan({ wallet: getAddress(q.wallet.toLowerCase()), action: q.action, stock, deposit: q.deposit, usdc: q.usdc });
    return NextResponse.json(plan, { headers: CORS });
  } catch (e) {
    if (e instanceof PlanError) return NextResponse.json({ ok: false, error: "refused", message: e.message }, { status: 422, headers: CORS });
    return NextResponse.json({ ok: false, error: "failed", message: logAndMask("bankr-loan", e) }, { status: 502, headers: CORS });
  }
}
