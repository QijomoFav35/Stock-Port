/**
 * Basket leaderboard from onchain Chainlink NAV history: no database, anyone can recompute it.
 *
 * For each stock we find the feed's price at (now - 24h) and (now - 7d) by binary-searching the
 * feed's rounds in its current phase (Chainlink proxy round id = phaseId << 64 | aggregatorRoundId).
 * Basket return = Σ weight × (price_now / price_then − 1). NAV feeds are total-return references
 * and hold their value when the market is closed.
 */
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { BASKETS, UNIVERSE } from "@/lib/baskets";
import { feedFor } from "@/lib/aerodrome";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";

const roundAbi = [
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
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ type: "uint80", name: "roundId" }],
    outputs: [
      { type: "uint80", name: "roundId" },
      { type: "int256", name: "answer" },
      { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" },
      { type: "uint80", name: "answeredInRound" },
    ],
  },
] as const;

const MASK = (1n << 64n) - 1n;

/** Feed answer at or before `ts` (unix seconds). Falls back to the oldest round of the current phase. */
async function answerAt(feed: Address, ts: number): Promise<{ now: bigint; then: bigint }> {
  const latest = await publicClient.readContract({ address: feed, abi: roundAbi, functionName: "latestRoundData" });
  const phase = latest[0] >> 64n;
  let lo = 1n;
  let hi = latest[0] & MASK;
  const now = latest[1];
  if (Number(latest[3]) <= ts) return { now, then: now };
  let best: bigint | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    const r = await publicClient
      .readContract({ address: feed, abi: roundAbi, functionName: "getRoundData", args: [(phase << 64n) | mid] })
      .catch(() => undefined);
    if (!r || r[3] === 0n) {
      lo = mid + 1n; // missing round: search later
      continue;
    }
    if (Number(r[3]) <= ts) {
      best = r[1];
      lo = mid + 1n;
    } else {
      hi = mid - 1n;
    }
  }
  if (best === undefined) {
    const first = await publicClient
      .readContract({ address: feed, abi: roundAbi, functionName: "getRoundData", args: [(phase << 64n) | 1n] })
      .catch(() => undefined);
    best = first && first[1] > 0n ? first[1] : now;
  }
  return { now, then: best };
}

export type BasketRow = { id: string; name: string; color: string; ink: string; d1: number; d7: number };
export type StockMove = { symbol: string; d1: number; d7: number };
export type Leaderboard = { baskets: BasketRow[]; stocks: StockMove[]; asOf: number };

let cache: { at: number; value: Leaderboard } | undefined;
let inflight: Promise<Leaderboard> | undefined;
const TTL = 15 * 60_000;

async function compute(): Promise<Leaderboard> {
  const all = await listTokenizedStocks();
  const nowS = Math.floor(Date.now() / 1000);
  const moves: StockMove[] = [];
  // Sequential per stock keeps us under public RPC rate limits.
  for (const sym of UNIVERSE) {
    const t = all.find((x) => x.symbol === sym);
    if (!t) continue;
    const feed = await feedFor(sym, getAddress(t.contract_address));
    if (!feed) continue;
    try {
      const a = await answerAt(feed, nowS - 86_400);
      const b = await answerAt(feed, nowS - 7 * 86_400);
      moves.push({
        symbol: sym,
        d1: a.then > 0n ? Number(a.now) / Number(a.then) - 1 : 0,
        d7: b.then > 0n ? Number(b.now) / Number(b.then) - 1 : 0,
      });
    } catch (e) {
      console.warn(`[leaderboard] ${sym}: ${(e as Error).message}`);
    }
  }
  const by = new Map(moves.map((m) => [m.symbol, m]));
  const baskets = BASKETS.map((bk) => {
    let d1 = 0;
    let d7 = 0;
    for (const l of bk.legs) {
      const m = by.get(l.symbol);
      if (!m) continue;
      d1 += (l.weightBps / 10_000) * m.d1;
      d7 += (l.weightBps / 10_000) * m.d7;
    }
    return { id: bk.id, name: bk.name, color: bk.color, ink: bk.ink, d1, d7 };
  }).sort((x, y) => y.d7 - x.d7);
  return { baskets, stocks: moves.sort((x, y) => y.d1 - x.d1), asOf: Date.now() };
}

/** Cached 15 min per server process; concurrent callers share one computation. */
export async function getLeaderboard(): Promise<Leaderboard> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  inflight ??= compute()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}
