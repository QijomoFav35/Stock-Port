/**
 * Dev only: serves AutoPilot creation code from build/ with its constructor arguments
 * (every universe stock that has a Chainlink NAV feed, and that feed) to the /deploy-autopilot page.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { encodeAbiParameters, getAddress, type Address } from "viem";
import { UNIVERSE } from "@/lib/baskets";
import { resolveSymbols } from "@/lib/tokenizedStocks";
import { feedFor } from "@/lib/aerodrome";

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
  const rows: { symbol: string; token: Address; feed: Address }[] = [];
  for (const t of tokens) {
    const token = getAddress(t.contract_address.toLowerCase());
    const feed = await feedFor(t.symbol, token);
    if (feed) rows.push({ symbol: t.symbol, token, feed: getAddress(feed.toLowerCase()) });
  }
  if (!rows.length) return NextResponse.json({ error: "No stocks with a NAV feed found" }, { status: 502 });
  const args = encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }], [rows.map((r) => r.token), rows.map((r) => r.feed)]);
  return NextResponse.json({ bytecode: `0x${bin}${args.slice(2)}`, stocks: rows.map((r) => r.symbol) });
}
