/**
 * POST /api/paymaster: ERC-7677 proxy to the CDP Paymaster.
 * Keeps CDP_PAYMASTER_URL (it contains the key) on the server. Only the two paymaster methods pass.
 * Which contracts get sponsored, and how much per user, is set in the CDP dashboard allowlist.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { BASE_CHAIN_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

const METHODS = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData"]);
const CHAIN_HEX = "0x" + BASE_CHAIN_ID.toString(16);
// The wallet (e.g. the Base Account popup) calls this from its own origin.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const url = process.env.CDP_PAYMASTER_URL;
  if (process.env.NEXT_PUBLIC_GASLESS !== "1" || !url) {
    return NextResponse.json({ error: "gasless_off" }, { status: 404, headers: CORS });
  }
  if (isTradingBlocked(req.headers.get(GEO_HEADER))) {
    return NextResponse.json({ error: "geo_blocked" }, { status: 451, headers: CORS });
  }
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "too_large" }, { status: 413, headers: CORS });
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400, headers: CORS });
  }
  if (!body || Array.isArray(body) || !METHODS.has(String(body.method))) {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 400, headers: CORS });
  }
  // params = [userOp, entryPoint, chainId, context]. Base mainnet only.
  if (!Array.isArray(body.params) || String(body.params[2]).toLowerCase() !== CHAIN_HEX) {
    return NextResponse.json({ error: "wrong_chain" }, { status: 400, headers: CORS });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, method: body.method, params: body.params }),
  });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { ...CORS, "content-type": "application/json" } });
}
