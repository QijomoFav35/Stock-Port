/**
 * Basket leaderboard from onchain Chainlink NAV history: no database, anyone can recompute it.
 *
 * For each stock we find the feed's price at (now - 24h) and (now - 7d) by searching the feed's
 * rounds in its current phase (Chainlink proxy round id = phaseId << 64 | aggregatorRoundId).
 * The search is 16-way and batched through Multicall3: every step probes 15 rounds for every
 * stock and both dates in one call, so the whole board takes about 4 round trips.
 * Basket return = Σ weight × (price_now / price_then − 1). NAV feeds are total-return references
 * and hold their value when the market is closed.
 */
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { BASKETS, UNIVERSE } from "@/lib/baskets";
import { feedFor } from "@/lib/aerodrome";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";

const roundOutputs = [
  { type: "uint80", name: "roundId" },
  { type: "int256", name: "answer" },
  { type: "uint256", name: "startedAt" },
  { type: "uint256", name: "updatedAt" },
  { type: "uint80", name: "answeredInRound" },
] as const;
const roundAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: roundOutputs },
  { type: "function", name: "getRoundData", stateMutability: "view", inputs: [{ type: "uint80", name: "roundId" }], outputs: roundOutputs },
] as const;

const MASK = (1n << 64n) - 1n;
const PROBES = 15;
const MAX_STEPS = 8;
const BATCH_BYTES = 16_384;

type Search = {
  feed: Address;
  phase: bigint;
  ts: number;
  lo: bigint; // largest round known to be at or before ts (0 = none found yet)
  hi: bigint; // smallest round known to be after ts
  loAnswer?: bigint;
};

/** Up to PROBES evenly spaced rounds strictly between lo and hi. */
function probesFor(s: Search): bigint[] {
  const gap = s.hi - s.lo;
  if (gap <= 1n) return [];
  const n = gap - 1n < BigInt(PROBES) ? Number(gap - 1n) : PROBES;
  const out = new Set<bigint>();
  for (let i = 1; i <= n; i++) out.add(s.lo + (gap * BigInt(i)) / BigInt(n + 1));
  return [...out].filter((r) => r > s.lo && r < s.hi);
}

/** Runs every search to the end, batching all probes of a step into one multicall. */
async function runSearches(searches: Search[]) {
  for (let step = 0; step < MAX_STEPS; step++) {
    const plan = searches.map((s) => ({ s, rounds: probesFor(s) })).filter((p) => p.rounds.length);
    if (!plan.length) return;
    const contracts = plan.flatMap(({ s, rounds }) =>
      rounds.map((r) => ({ address: s.feed, abi: roundAbi, functionName: "getRoundData" as const, args: [(s.phase << 64n) | r] as const })),
    );
    const res = await publicClient.multicall({ contracts, allowFailure: true, batchSize: BATCH_BYTES });
    let k = 0;
    let progressed = false;
    for (const { s, rounds } of plan) {
      let lo = s.lo;
      let loAnswer = s.loAnswer;
      let hi = s.hi;
      for (const r of rounds) {
        const x = res[k++];
        if (x.status !== "success" || x.result[3] === 0n) continue; // missing round
        if (Number(x.result[3]) <= s.ts) {
          if (r > lo) {
            lo = r;
            loAnswer = x.result[1];
          }
        } else if (r < hi) {
          hi = r;
        }
      }
      if (lo !== s.lo || hi !== s.hi) progressed = true;
      s.lo = lo;
      s.hi = hi;
      s.loAnswer = loAnswer;
    }
    if (!progressed) return; // only missing rounds left in the gaps
  }
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
  type FeedRow = { sym: string; feed: Address };
  const found = await Promise.all(
      UNIVERSE.map(async (sym: string): Promise<FeedRow | undefined> => {
        const t = all.find((x) => x.symbol === sym);
        const feed = t ? await feedFor(sym, getAddress(t.contract_address)) : undefined;
        return feed ? { sym, feed } : undefined;
      }),
  );
  const feeds = found.filter((x): x is FeedRow => !!x);

  const latest = await publicClient.multicall({
    contracts: feeds.map((f) => ({ address: f.feed, abi: roundAbi, functionName: "latestRoundData" as const })),
    allowFailure: true,
    batchSize: BATCH_BYTES,
  });

  const rows: { sym: string; now: bigint; d1: Search; d7: Search }[] = [];
  feeds.forEach((f, i) => {
    const l = latest[i];
    if (l.status !== "success" || l.result[1] <= 0n) return console.warn(`[leaderboard] ${f.sym}: no latest round`);
    const [roundId, answer, , updatedAt] = l.result;
    const phase = roundId >> 64n;
    const agg = roundId & MASK;
    const mk = (ts: number): Search =>
      Number(updatedAt) <= ts
        ? { feed: f.feed, phase, ts, lo: agg, hi: agg + 1n, loAnswer: answer } // no update since ts
        : { feed: f.feed, phase, ts, lo: 0n, hi: agg };
    rows.push({ sym: f.sym, now: answer, d1: mk(nowS - 86_400), d7: mk(nowS - 7 * 86_400) });
  });

  await runSearches(rows.flatMap((r) => [r.d1, r.d7]));

  // Feed younger than the window: compare with its first round in this phase.
  const firsts = rows.flatMap((r) => [r.d1, r.d7]).filter((s) => s.loAnswer === undefined);
  if (firsts.length) {
    const res = await publicClient.multicall({
      contracts: firsts.map((s) => ({ address: s.feed, abi: roundAbi, functionName: "getRoundData" as const, args: [(s.phase << 64n) | 1n] as const })),
      allowFailure: true,
      batchSize: BATCH_BYTES,
    });
    firsts.forEach((s, i) => {
      const x = res[i];
      if (x.status === "success" && x.result[1] > 0n) s.loAnswer = x.result[1];
    });
  }

  const move = (now: bigint, then?: bigint) => (then && then > 0n ? Number(now) / Number(then) - 1 : 0);
  const moves: StockMove[] = rows.map((r) => ({ symbol: r.sym, d1: move(r.now, r.d1.loAnswer), d7: move(r.now, r.d7.loAnswer) }));

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
