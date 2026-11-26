/**
 * Dev only: serves AutoPilot creation code from build/ with its constructor arguments to the /deploy-autopilot page.
 * Each universe stock is included when it has a Chainlink NAV feed and a router pool with at least $1k of USDC
 * whose price is within the NAV drift limit. That pool is pinned in the contract for good.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { encodeAbiParameters, getAddress, type Address } from "viem";
import { UNIVERSE } from "@/lib/baskets";
import { resolveSymbols } from "@/lib/tokenizedStocks";
import { feedFor, findDeepestPool } from "@/lib/aerodrome";
import { getPegHealth } from "@/lib/pegHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "not_found" }, { status: 404 });
  let bin: string;
  try {
    bin = (await readFile("build/contracts_AutoPilot_sol_AutoPilot.bin", "utf8")).trim();
  } catch {
    return NextResponse.json({ error: "Run npm run autopilot:build first" }, { status: 400 });
  }
  const tokens = await resolveSymbols([...UNIVERSE]);
  const peg = await getPegHealth(tokens);
  const rows: { symbol: string; token: Address; feed: Address; tickSpacing: number; poolUsdc: number }[] = [];
  const skipped: string[] = [];
  for (const [i, t] of tokens.entries()) {
    const token = getAddress(t.contract_address.toLowerCase());
    const [feed, pool] = await Promise.all([feedFor(t.symbol, token), findDeepestPool(token).catch(() => undefined)]);
    const p = peg[i];
    const pegOk = p && p.status !== "paused" && p.spreadPct !== undefined && (!p.pool || !pool || p.pool.toLowerCase() === pool.pool.toLowerCase());
    if (!feed || !pool || !pegOk) {
      skipped.push(`${t.symbol} (${!feed ? "no feed" : !pool ? "no pool" : "pool off NAV"})`);
      continue;
    }
    rows.push({ symbol: t.symbol, token, feed: getAddress(feed.toLowerCase()), tickSpacing: pool.tickSpacing, poolUsdc: Number(pool.usdc / 1_000_000n) });
  }
  if (!rows.length) return NextResponse.json({ error: "No stocks with a NAV feed and a healthy pool found" }, { status: 502 });
  const args = encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[]" }, { type: "int24[]" }],
    [rows.map((r) => r.token), rows.map((r) => r.feed), rows.map((r) => r.tickSpacing)],
  );
  return NextResponse.json({
    bytecode: `0x${bin}${args.slice(2)}`,
    stocks: rows.map((r) => `${r.symbol} (pool ${r.tickSpacing}, $${r.poolUsdc.toLocaleString("en-US")})`),
    skipped,
  });
}
