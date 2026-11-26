/**
 * Guard Agent: the brain on top of LoanGuard.
 *
 * Every run it:
 * 1. Finds every borrower on the Aave V4 "Coinbase Stocks" Spoke (from the Spoke's own logs, no indexer).
 * 2. Reads each loan's health, and which tokenized stocks back it.
 * 3. Projects health at the next open. While US markets are shut, Aave's NAV prices are frozen but the
 *    tokens keep trading in Base pools, so the pool price is the best live hint of where NAV opens.
 *    projected = health × (collateral at pool prices) ÷ (collateral at NAV), weighted by collateral factor.
 * 4. Decides per loan: protect now (LoanGuard says it may), warn (projected under trigger), or hold.
 *
 * The decisions that move money run through LoanGuard.protect, which re-checks every rule onchain, so the
 * agent can't spend more than the user's reserve or act on a healthy loan. Everything here is read from
 * Base. Nothing is simulated.
 */
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { AAVE_ORACLE, AAVE_SPOKE, STOCK_RESERVES, aaveOracleAbi, spokeAbi } from "@/lib/aave";
import { LOAN_GUARD, loanGuardAbi } from "@/lib/loanGuard";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";
import { getPegHealth } from "@/lib/pegHealth";
import { keeperLog } from "@/lib/guardKeeper";
import { marketClosed, untilFlip } from "@/lib/marketClock";

// --- borrower discovery from Spoke logs ---
const SPOKE_FROM_BLOCK = BigInt(process.env.AAVE_SPOKE_FROM_BLOCK || "59900000");
const STEP = 50_000n;
type Scan = { cursor: bigint; candidates: Set<Address>; running?: Promise<void> };
const g = globalThis as unknown as { __agentScan?: Scan; __agentRun?: { at: number; report: AgentReport }; __agentBusy?: Promise<AgentReport>; __agentLog?: AgentLogLine[] };

/** Indexed address topics on Spoke events are the users acting or acted on. Collect them all, filter by debt later. */
async function scanBorrowers(budgetMs: number): Promise<Set<Address>> {
  const st = (g.__agentScan ??= { cursor: SPOKE_FROM_BLOCK, candidates: new Set<Address>() });
  st.running ??= (async () => {
    const started = Date.now();
    const head = await publicClient.getBlockNumber();
    let step = STEP;
    while (st.cursor <= head && Date.now() - started < budgetMs) {
      const to = st.cursor + step - 1n > head ? head : st.cursor + step - 1n;
      const logs = await publicClient.getLogs({ address: AAVE_SPOKE, fromBlock: st.cursor, toBlock: to }).catch(() => null);
      if (!logs) {
        if (step <= 500n) break;
        step /= 4n;
        continue;
      }
      for (const l of logs) {
        for (const t of l.topics.slice(1)) {
          if (t && /^0x0{24}[0-9a-fA-F]{40}$/.test(t) && !/^0x0{64}$/.test(t)) st.candidates.add(getAddress(`0x${t.slice(26)}`));
        }
      }
      st.cursor = to + 1n;
    }
  })().finally(() => (st.running = undefined));
  await st.running;
  return st.candidates;
}

// --- types ---
export type LoanView = {
  user: string; // masked
  health: number;
  projected: number;
  debtUsd: number;
  collateral: string[];
  guarded: boolean;
  trigger?: number;
  reserveUsd?: number;
  decision: "protect" | "warn" | "hold";
  why: string;
};
export type AgentLogLine = { at: number; text: string };
export type AgentReport = {
  at: number;
  marketClosed: boolean;
  flipInMs: number;
  scanned: number;
  borrowers: number;
  guarded: number;
  drift: { symbol: string; pct: number }[];
  loans: LoanView[];
  log: AgentLogLine[];
};

const mask = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const CACHE_MS = 60_000;
const WATCH_BELOW = 1.5; // show loans whose projected health is under this

async function run(): Promise<AgentReport> {
  const now = Date.now();
  const closed = marketClosed(now);
  const candidates = [...(await scanBorrowers(8000))];

  // Live drift: pool price vs NAV for each collateral stock.
  const all = await listTokenizedStocks();
  const pegs = await getPegHealth(all.filter((t) => STOCK_RESERVES.some((r) => r.symbol === t.symbol))).catch(() => []);
  const ratio = new Map<string, number>();
  for (const p of pegs) if (p.poolPrice && p.refPrice) ratio.set(p.symbol, p.poolPrice / p.refPrice);

  const prices = (await publicClient.multicall({
    allowFailure: true,
    contracts: STOCK_RESERVES.map((r) => ({ address: AAVE_ORACLE, abi: aaveOracleAbi, functionName: "getReservePrice", args: [r.reserveId] }) as const),
  })).map((r) => (r.status === "success" ? Number(r.result) / 1e8 : 0));

  // Account data for every candidate; keep the ones with debt.
  const acct = await publicClient.multicall({
    allowFailure: true,
    contracts: candidates.map((u) => ({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserAccountData", args: [u] }) as const),
  });
  const borrowers = candidates
    .map((u, i) => ({ u, r: acct[i] }))
    .filter((x) => x.r.status === "success" && (x.r.result as unknown as readonly bigint[])[4] > 0n)
    .map((x) => {
      const d = x.r.result as unknown as readonly bigint[];
      return { user: x.u, health: Number(d[2]) / 1e18, debtUsd: Number(d[4] / 10n ** 27n) / 1e26 };
    });

  // Collateral mix per borrower.
  const supplied = borrowers.length
    ? await publicClient.multicall({
        allowFailure: true,
        contracts: borrowers.flatMap((b) =>
          STOCK_RESERVES.map((r) => ({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserSuppliedAssets", args: [r.reserveId, b.user] }) as const),
        ),
      })
    : [];

  // Guard settings for borrowers who use LoanGuard.
  const guards = LOAN_GUARD && borrowers.length
    ? await publicClient.multicall({
        allowFailure: true,
        contracts: borrowers.map((b) => ({ address: LOAN_GUARD!, abi: loanGuardAbi, functionName: "guards", args: [b.user] }) as const),
      })
    : [];
  const checks = LOAN_GUARD && borrowers.length
    ? await publicClient.multicall({
        allowFailure: true,
        contracts: borrowers.map((b) => ({ address: LOAN_GUARD!, abi: loanGuardAbi, functionName: "check", args: [b.user] }) as const),
      })
    : [];

  const loans: LoanView[] = borrowers.map((b, i) => {
    let navValue = 0;
    let poolValue = 0;
    const mix: string[] = [];
    STOCK_RESERVES.forEach((r, j) => {
      const s = supplied[i * STOCK_RESERVES.length + j];
      const amt = s?.status === "success" ? Number(s.result as bigint) / 10 ** r.decimals : 0;
      if (amt <= 0) return;
      const w = amt * prices[j] * r.collateralFactor;
      navValue += w;
      poolValue += w * (ratio.get(r.symbol) ?? 1);
      mix.push(r.symbol);
    });
    const projected = navValue > 0 ? b.health * (poolValue / navValue) : b.health;

    const gr = guards[i];
    const gv = gr?.status === "success" ? (gr.result as unknown as readonly bigint[]) : undefined;
    const guarded = !!gv && gv[1] > 0n;
    const trig = gv ? Number(closed && gv[3] > 0n ? gv[3] : gv[1]) / 1e18 : undefined;
    const reserveUsd = gv ? Number(gv[0]) / 1e6 : undefined;
    const ck = checks[i];
    const needed = ck?.status === "success" && (ck.result as readonly unknown[])[0] === true;

    let decision: LoanView["decision"] = "hold";
    let why: string;
    const p = projected.toFixed(2);
    const h = b.health.toFixed(2);
    if (guarded && needed) {
      decision = "protect";
      why = `Health ${h} is under its ${trig!.toFixed(2)} trigger. Repaying from the $${reserveUsd!.toFixed(0)} reserve.`;
    } else if (guarded && trig && projected < trig) {
      decision = "warn";
      why = `Pools point to ${p} at the open, under its ${trig.toFixed(2)} trigger. Ready to repay${reserveUsd ? ` up to $${reserveUsd.toFixed(0)}` : ""}.`;
    } else if (!guarded && projected < 1.15) {
      decision = "warn";
      why = `Pools point to ${p} at the open. No guard: this loan has no automatic defense.`;
    } else {
      why = guarded ? `Health ${h}, pools point to ${p}. Above its trigger.` : `Health ${h}, pools point to ${p}.`;
    }
    return { user: mask(b.user), health: b.health, projected, debtUsd: b.debtUsd, collateral: mix, guarded, trigger: trig, reserveUsd, decision, why };
  });

  const watch = loans.filter((l) => l.guarded || l.projected < WATCH_BELOW).sort((a, b) => a.projected - b.projected);
  const drift = [...ratio.entries()].map(([symbol, r]) => ({ symbol, pct: (r - 1) * 100 })).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  // Agent log: one line per run, plus a line per decision that isn't "hold".
  const log = (g.__agentLog ??= []);
  const atRisk = loans.filter((l) => l.decision !== "hold").length;
  const worst = drift[0];
  log.unshift({
    at: now,
    text:
      `Checked ${loans.length} Aave stock loans` +
      (worst ? `. Biggest NAV gap: ${worst.symbol} pool ${Math.abs(worst.pct).toFixed(2)}% ${worst.pct >= 0 ? "above" : "below"} NAV` : "") +
      `. ${atRisk ? `${atRisk} flagged.` : "All clear."}`,
  });
  for (const l of watch.filter((x) => x.decision !== "hold").slice(0, 3)) log.unshift({ at: now, text: `${l.user}: ${l.why}` });
  const k = keeperLog()[0];
  if (k && k.protected > 0 && now - k.at < CACHE_MS) log.unshift({ at: k.at, text: `Topped up ${k.protected} loan${k.protected > 1 ? "s" : ""} onchain.` });
  log.splice(40);

  return {
    at: now,
    marketClosed: closed,
    flipInMs: untilFlip(now),
    scanned: candidates.length,
    borrowers: loans.length,
    guarded: loans.filter((l) => l.guarded).length,
    drift: drift.slice(0, 8),
    loans: watch.slice(0, 15),
    log: log.slice(0, 12),
  };
}

/** One shared run per minute for all visitors. */
export async function getAgentReport(): Promise<AgentReport> {
  const c = g.__agentRun;
  if (c && Date.now() - c.at < CACHE_MS) return c.report;
  g.__agentBusy ??= run()
    .then((report) => {
      g.__agentRun = { at: Date.now(), report };
      return report;
    })
    .finally(() => (g.__agentBusy = undefined));
  return g.__agentBusy;
}
