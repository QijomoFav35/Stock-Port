/**
 * Live port feed: real tokenized-stock flows on Base from the last few minutes, plus what our agents are doing now.
 * Everything comes from the chain (Transfer logs, pool prices, Chainlink NAV). Nothing is simulated.
 * - Buy / sell: a transfer out of / into the deepest USDC pool for that stock.
 * - Mint / redeem: a transfer from / to the zero address (new tokens issued or burned by the issuer).
 * - Stock Port txs (found by Builder Code in lib/usage.ts) are flagged so the UI can highlight them.
 */
import { formatUnits, getAddress, parseAbiItem, zeroAddress, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { UNIVERSE } from "@/lib/baskets";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";
import { getPegHealth } from "@/lib/pegHealth";
import { PEG_LABEL } from "@/lib/peg";
import { keeperLog } from "@/lib/guardKeeper";
import { LOAN_GUARD } from "@/lib/loanGuard";
import { isPortTx } from "@/lib/usage";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const WINDOWS = [150n, 900n, 1800n]; // 5 min, 30 min, 1 h of Base blocks: widen until we have enough rows
const MIN_ROWS = 8;
const CACHE_MS = 15_000;

export type LiveFlow = { hash: Hex; symbol: string; kind: "buy" | "sell" | "mint" | "redeem"; amount: number; usd?: number; ago: number; port: boolean };
export type AgentLine = { agent: string; text: string; ok: boolean };
export type LiveFeed = { at: number; windowMin: number; flows: LiveFlow[]; agents: AgentLine[] };

const g = globalThis as unknown as { __live?: { at: number; feed: LiveFeed }; __liveRun?: Promise<LiveFeed> };

async function build(): Promise<LiveFeed> {
  const all = await listTokenizedStocks();
  const stocks = all.filter((t) => (UNIVERSE as readonly string[]).includes(t.symbol));
  const peg = await getPegHealth(stocks).catch(() => []);
  const bySym = new Map(stocks.map((t) => [getAddress(t.contract_address), t]));
  const pools = new Map<string, Address>();
  for (const p of peg) {
    const t = stocks.find((s) => s.symbol === p.symbol);
    if (t && p.pool) pools.set(getAddress(t.contract_address), getAddress(p.pool));
  }

  const head = await publicClient.getBlockNumber();
  let logs: Awaited<ReturnType<typeof fetchLogs>> = [];
  let span = WINDOWS[0];
  for (const w of WINDOWS) {
    span = w;
    logs = await fetchLogs([...bySym.keys()], head - w, head);
    if (logs.length >= MIN_ROWS) break;
  }

  // One row per tx and stock: keep the biggest transfer (a swap can touch several hops).
  const rows = new Map<string, LiveFlow & { block: bigint }>();
  for (const l of logs) {
    const token = getAddress(l.address);
    const t = bySym.get(token);
    const { from, to, value } = l.args;
    if (!t || !from || !to || value === undefined || !l.transactionHash || l.blockNumber === null) continue;
    const pool = pools.get(token);
    const kind: LiveFlow["kind"] | undefined =
      from === zeroAddress ? "mint" : to === zeroAddress ? "redeem" : pool && from === pool ? "buy" : pool && to === pool ? "sell" : undefined;
    if (!kind) continue;
    const amount = Number(formatUnits(value, t.decimals));
    const key = `${l.transactionHash}:${t.symbol}`;
    const prev = rows.get(key);
    if (prev && prev.amount >= amount) continue;
    rows.set(key, {
      hash: l.transactionHash,
      symbol: t.symbol,
      kind,
      amount,
      usd: t.nav_price ? amount * t.nav_price : undefined,
      ago: Number(head - l.blockNumber) * 2000, // Base: one block every 2 s
      port: isPortTx(l.transactionHash),
      block: l.blockNumber,
    });
  }
  const flows = [...rows.values()]
    .sort((a, b) => Number(b.block - a.block))
    .slice(0, 24)
    .map((f): LiveFlow => ({ hash: f.hash, symbol: f.symbol, kind: f.kind, amount: f.amount, usd: f.usd, ago: f.ago, port: f.port }));

  const agents: AgentLine[] = peg
    .filter((p) => p.spreadPct !== undefined)
    .map((p) => ({
      agent: "Drift guard",
      text: `${p.symbol} pool ${Math.abs(p.spreadPct!).toFixed(2)}% ${p.spreadPct! >= 0 ? "above" : "below"} NAV · ${PEG_LABEL[p.status]}`,
      ok: p.status === "healthy" || p.status === "watch",
    }));
  const last = keeperLog()[0];
  if (LOAN_GUARD && last) {
    agents.unshift({
      agent: "Loan Guard",
      text: `Checked ${last.checked} loans · ${last.atRisk} under trigger · ${last.protected} topped up`,
      ok: last.atRisk === 0 || last.protected > 0,
    });
  }

  return { at: Date.now(), windowMin: Number(span) / 30, flows, agents };
}

function fetchLogs(address: Address[], fromBlock: bigint, toBlock: bigint) {
  return publicClient.getLogs({ address, event: TRANSFER, fromBlock, toBlock });
}

/** Cached for 15 s and shared by all visitors, so the page polling doesn't multiply RPC calls. */
export async function getLiveFeed(): Promise<LiveFeed> {
  const c = g.__live;
  if (c && Date.now() - c.at < CACHE_MS) return c.feed;
  g.__liveRun ??= build()
    .then((feed) => {
      g.__live = { at: Date.now(), feed };
      return feed;
    })
    .finally(() => (g.__liveRun = undefined));
  return g.__liveRun;
}
