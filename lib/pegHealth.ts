/**
 * Peg health: how far the live Aerodrome pool price is from the Coinbase Chainlink reference (NAV).
 *
 * pool price = spot price of the deepest router-compatible USDC pool (slot0, no price impact)
 * reference  = the Chainlink feed for that stock, read onchain (same source as the API's nav_price)
 * spread     = (pool - reference) / reference, in %
 *
 * Above NAV_DRIFT_MAX_PCT (lib/peg.ts) the basket buy is refused (the pool is off peg, so you'd overpay or the tx
 * would revert on its min out). A stale reference (market closed for days, or the feed stopped) is
 * shown as "stale" and does not block: the min out on every Aerodrome buy still uses the feed.
 */
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE, USDC_DECIMALS } from "@/lib/constants";
import { feedFor, findDeepestPool } from "@/lib/aerodrome";
import { NAV_STALE_MS, type TokenizedStock } from "@/lib/tokenizedStocks";
import { pegStatus, type PegHealth } from "@/lib/peg";

export type { PegHealth } from "@/lib/peg";

const slot0Abi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint16", name: "observationIndex" },
      { type: "uint16", name: "observationCardinality" },
      { type: "uint16", name: "observationCardinalityNext" },
      { type: "bool", name: "unlocked" },
    ],
  },
] as const;
const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint80", name: "roundId" },
      { type: "int256", name: "answer" },
      { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" },
      { type: "uint80", name: "answeredInRound" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** USDC per share from a CL pool's sqrtPriceX96. token0 is the lower address. */
export function poolPriceUsdc(sqrtPriceX96: bigint, stock: Address, stockDecimals: number) {
  const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // token1 raw per token0 raw
  const usdcIsToken0 = BigInt(getAddress(USDC_BASE)) < BigInt(getAddress(stock));
  // usdcIsToken0: ratio = stock raw per USDC raw. Otherwise ratio = USDC raw per stock raw.
  const scale = 10 ** (stockDecimals - USDC_DECIMALS);
  return usdcIsToken0 ? scale / ratio : ratio * scale;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: PegHealth }>();

async function readPeg(t: TokenizedStock): Promise<PegHealth> {
  const symbol = t.symbol;
  const token = getAddress(t.contract_address);
  const feed = await feedFor(symbol, token);
  const [best, round, feedDecimals] = await Promise.all([
    findDeepestPool(token),
    feed ? publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }) : undefined,
    feed ? publicClient.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }) : undefined,
  ]);
  // No onchain feed configured: fall back to the API's nav_price (same Chainlink source, may lag).
  const refPrice = round && feedDecimals !== undefined && round[1] > 0n ? Number(round[1]) / 10 ** feedDecimals : t.nav_price;
  const refUpdatedAt = round ? Number(round[3]) * 1000 : t.nav_price_updated_at ? Date.parse(t.nav_price_updated_at) : undefined;
  if (!best) return { symbol, status: "unknown", refPrice, refUpdatedAt };

  const [sqrtPriceX96] = await publicClient.readContract({ address: best.pool, abi: slot0Abi, functionName: "slot0" });
  const poolPrice = poolPriceUsdc(sqrtPriceX96, token, t.decimals);
  if (!refPrice) return { symbol, status: "unknown", poolPrice, pool: best.pool };

  const spreadPct = ((poolPrice - refPrice) / refPrice) * 100;
  const stale = !refUpdatedAt || Date.now() - refUpdatedAt > NAV_STALE_MS;
  return { symbol, status: stale ? "stale" : pegStatus(spreadPct), poolPrice, refPrice, spreadPct, refUpdatedAt, pool: best.pool };
}

/** Peg health per token, cached 60s per server process. A failed read returns status "unknown". */
export async function getPegHealth(tokens: TokenizedStock[]): Promise<PegHealth[]> {
  return Promise.all(
    tokens.map(async (t) => {
      const hit = cache.get(t.symbol);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
      const value = await readPeg(t).catch((e): PegHealth => {
        console.warn(`[peg] ${t.symbol}: ${(e as Error).message}`);
        return { symbol: t.symbol, status: "unknown" };
      });
      cache.set(t.symbol, { at: Date.now(), value });
      return value;
    }),
  );
}
