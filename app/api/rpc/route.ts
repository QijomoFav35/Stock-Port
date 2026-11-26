/**
 * POST /api/rpc: read-only JSON-RPC proxy for the browser, so the RPC key stays on the server.
 * Only read methods pass (no eth_sendRawTransaction, no debug/trace, no logs scans). Rate-limited per IP
 * in middleware.ts.
 */
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const READ_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
]);
const MAX_BODY = 256_000;
const MAX_BATCH = 20;

type RpcReq = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function POST(req: NextRequest) {
  const upstream = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json(rpcError(null, -32600, "Request too large"), { status: 413 });
  let body: RpcReq | RpcReq[];
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return NextResponse.json(rpcError(null, -32600, "Bad batch size"), { status: 400 });
  for (const c of calls) {
    if (!c || typeof c !== "object" || typeof c.method !== "string" || !READ_METHODS.has(c.method)) {
      return NextResponse.json(rpcError(c?.id, -32601, "Method not allowed"), { status: 400 });
    }
    if (c.params !== undefined && !Array.isArray(c.params)) return NextResponse.json(rpcError(c.id, -32602, "Invalid params"), { status: 400 });
  }
  const clean = calls.map((c) => ({ jsonrpc: "2.0", id: c.id ?? 1, method: c.method, params: c.params ?? [] }));
  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Array.isArray(body) ? clean : clean[0]),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    console.error("[rpc] upstream failed", e);
    return NextResponse.json(rpcError(Array.isArray(body) ? null : body.id, -32603, "Upstream RPC unavailable"), { status: 502 });
  }
}
