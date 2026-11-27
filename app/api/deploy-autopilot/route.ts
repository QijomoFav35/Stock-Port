/**
 * Dev only: serves AutoPilot creation code from build/ with its constructor arguments to the /deploy-autopilot page.
 * Each universe stock is included when it has a Chainlink NAV feed and a router pool with at least $1k of USDC.
 * A pool clearly off NAV (fresh feed, spread above the drift limit) is left out. The chosen pool is pinned for good.
 * Reads run one at a time with retries, so a rate-limited RPC key doesn't fail the whole list.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { encodeAbiParameters, getAddress, type Address } from "viem";
import { UNIVERSE } from "@/lib/baskets";
import { resolveSymbols, NAV_STALE_MS } from "@/lib/tokenizedStocks";
import { feedFor, routerFactory } from "@/lib/aerodrome";
import { poolPriceUsdc } from "@/lib/pegHealth";
import { pegStatus } from "@/lib/peg";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE } from "@/lib/constants";

export const dynamic = "force-dynamic";

const MIN_POOL_USDC = 1_000n * 10n ** 6n;
const abi = [
  { type: "function", name: "tickSpacings", stateMutability: "view", inputs: [], outputs: [{ type: "int24[]" }] },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int24" }],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160" },
      { type: "int24" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "bool" },
    ],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(400 * 2 ** i);
    }
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "not_found" }, { status: 404 });
  let bin: string;
  try {
    bin = (await readFile("build/contracts_AutoPilot_sol_AutoPilot.bin", "utf8")).trim();
  } catch {
    return NextResponse.json({ error: "Run npm run autopilot:build first" }, { status: 400 });
  }
  let factory: Address;
  let spacings: number[];
  try {
    factory = await retry(() => routerFactory());
    spacings = (await retry(() => publicClient.readContract({ address: factory, abi, functionName: "tickSpacings" }))).map(Number);
  } catch (e) {
    console.error("[deploy-autopilot] RPC failed", (e as Error).message.split("\n")[0]);
    return NextResponse.json({ error: "Can't read Base right now (both BASE_RPC_URL and the public RPC failed). Try again in a minute." }, { status: 502 });
  }

  const tokens = await resolveSymbols([...UNIVERSE]);
  const rows: { symbol: string; token: Address; feed: Address; tickSpacing: number; poolUsdc: number }[] = [];
  const skipped: string[] = [];
  for (const t of tokens) {
    const token = getAddress(t.contract_address.toLowerCase());
    try {
      const feedRaw = await feedFor(t.symbol, token).catch(() => undefined);
      if (!feedRaw) {
        skipped.push(`${t.symbol} (no feed)`);
        continue;
      }
      const feed = getAddress(feedRaw.toLowerCase());
      let best: { pool: Address; tickSpacing: number; usdc: bigint } | undefined;
      for (const tickSpacing of spacings) {
        const pool = await retry(() => publicClient.readContract({ address: factory, abi, functionName: "getPool", args: [USDC_BASE, token, tickSpacing] }));
        if (/^0x0{40}$/i.test(pool)) continue;
        const usdc = await retry(() => publicClient.readContract({ address: USDC_BASE, abi, functionName: "balanceOf", args: [pool] }));
        if (usdc >= MIN_POOL_USDC && (!best || usdc > best.usdc)) best = { pool: getAddress(pool), tickSpacing, usdc };
      }
      if (!best) {
        skipped.push(`${t.symbol} (no pool with $1k+ USDC)`);
        continue;
      }
      const pool = best;
      const [slot0, round, dec] = await Promise.all([
        retry(() => publicClient.readContract({ address: pool.pool, abi, functionName: "slot0" })),
        retry(() => publicClient.readContract({ address: feed, abi, functionName: "latestRoundData" })),
        retry(() => publicClient.readContract({ address: feed, abi, functionName: "decimals" })),
      ]);
      const ref = Number(round[1]) / 10 ** dec;
      const fresh = Date.now() - Number(round[3]) * 1000 < NAV_STALE_MS;
      const spread = ref > 0 ? ((poolPriceUsdc(slot0[0], token, t.decimals) - ref) / ref) * 100 : 0;
      if (fresh && pegStatus(spread) === "paused") {
        skipped.push(`${t.symbol} (pool ${spread.toFixed(1)}% off NAV)`);
        continue;
      }
      rows.push({ symbol: t.symbol, token, feed, tickSpacing: pool.tickSpacing, poolUsdc: Number(pool.usdc / 1_000_000n) });
    } catch (e) {
      skipped.push(`${t.symbol} (read failed: ${(e as Error).message.split("\n")[0].replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 80)})`);
    }
  }
  if (!rows.length) return NextResponse.json({ error: `No stocks with a NAV feed and a healthy pool found.\n${skipped.join("\n")}` }, { status: 502 });
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
