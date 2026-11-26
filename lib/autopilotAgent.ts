/**
 * The AutoPilot agent (server only). Each pass:
 * 1. Reads every AutoPilot user and their onchain rules. Skips anyone who is off or picked another agent.
 * 2. Values what they hold inside the contract at Chainlink NAV and groups it by basket.
 * 3. Runs the same pure rules engine the Tap mode uses (lib/autopilot.ts decide) on the 7-day board.
 * 4. On rotate or buy: sells what doesn't belong in the target basket, buys the target legs with the USDC,
 *    dry-runs the rebalance, and sends it with the Builder Code.
 *
 * The contract enforces the limits itself (agent only, interval, weekend pause, NAV floor), so this code
 * can only pick moves inside them. Env: AUTOPILOT_AGENT_KEY (its own gas wallet, never the Loan Guard keeper key).
 */
import { createWalletClient, encodeFunctionData, getAddress, http, isAddressEqual, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { publicClient } from "@/lib/publicClient";
import { AUTOPILOT, autoPilotAbi, parsePilot, rulesFromPilot, type OnchainPilot } from "@/lib/autopilotContract";
import { decide, type AutoDecision } from "@/lib/autopilot";
import { marketClosed } from "@/lib/marketClock";
import { BASKETS, UNIVERSE } from "@/lib/baskets";
import { getLeaderboard } from "@/lib/leaderboard";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";
import { USDC_BASE } from "@/lib/constants";
import { DATA_SUFFIX, withBuilderCode } from "@/lib/attribution";

export type PilotEntry = {
  at: number;
  user: Address;
  action: AutoDecision["action"] | "skip";
  text: string;
  tx?: Hash;
  error?: string;
};
export type PilotRun = { at: number; checked: number; traded: number; entries: PilotEntry[] };

const LOG_MAX = 50;
const MIN_LEG_USDC = 500_000n; // skip buys under $0.50
const MIN_SELL_USD = 1;
const MAX_LEGS = 12;
const g = globalThis as unknown as { __apLog?: PilotRun[]; __apRunning?: boolean; __apPools?: Map<string, { at: number; ts?: number }> };
export const pilotLog = () => (g.__apLog ??= []);
export class PilotBusyError extends Error {}

function agentAccount() {
  // Its own key: the Loan Guard keeper key only pays gas, this one can trade inside users' rules.
  const pk = process.env.AUTOPILOT_AGENT_KEY as Hex | undefined;
  if (!pk || pk === process.env.KEEPER_PRIVATE_KEY) return undefined;
  return privateKeyToAccount(pk);
}
/** The agent's public address, which users pick in setPilot. */
export const agentAddress = (): Address | undefined => agentAccount()?.address;

type StockRow = { token: Address; symbol: string; decimals: number; feed: Address; feedDecimals: number; tickSpacing: number };

async function contractStocks(ap: Address): Promise<StockRow[]> {
  const n = await publicClient.readContract({ address: ap, abi: autoPilotAbi, functionName: "stockCount" });
  const idx = Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const tokens = (await publicClient.multicall({
    allowFailure: false,
    contracts: idx.map((i) => ({ address: ap, abi: autoPilotAbi, functionName: "stockList", args: [i] }) as const),
  })) as unknown as Address[];
  const info = await publicClient.multicall({
    allowFailure: false,
    contracts: tokens.map((t) => ({ address: ap, abi: autoPilotAbi, functionName: "stocks", args: [t] }) as const),
  });
  const listed = await listTokenizedStocks();
  const sym = new Map(listed.map((t) => [t.contract_address.toLowerCase(), t.symbol]));
  return tokens.map((token, i) => {
    const s = info[i] as unknown as readonly [Address, number, number, boolean, number];
    return {
      token: getAddress(token),
      symbol: sym.get(token.toLowerCase()) ?? token,
      feed: s[0],
      decimals: Number(s[1]),
      feedDecimals: Number(s[2]),
      tickSpacing: Number(s[4]),
    };
  });
}

const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
] as const;

async function navPrices(rows: StockRow[]): Promise<Map<string, number>> {
  const res = await publicClient.multicall({
    allowFailure: true,
    contracts: rows.map((r) => ({ address: r.feed, abi: feedAbi, functionName: "latestRoundData" }) as const),
  });
  const out = new Map<string, number>();
  rows.forEach((r, i) => {
    const x = res[i];
    if (x.status === "success") {
      const answer = (x.result as unknown as readonly bigint[])[1];
      if (answer > 0n) out.set(r.symbol, Number(answer) / 10 ** r.feedDecimals);
    }
  });
  return out;
}

export async function listPilots(ap: Address): Promise<{ user: Address; pilot: OnchainPilot }[]> {
  const n = await publicClient.readContract({ address: ap, abi: autoPilotAbi, functionName: "userCount" });
  const idx = Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const users = (await publicClient.multicall({
    allowFailure: false,
    contracts: idx.map((i) => ({ address: ap, abi: autoPilotAbi, functionName: "users", args: [i] }) as const),
  })) as unknown as Address[];
  const ps = await publicClient.multicall({
    allowFailure: false,
    contracts: users.map((u) => ({ address: ap, abi: autoPilotAbi, functionName: "pilots", args: [u] }) as const),
  });
  return users.map((user, i) => ({ user, pilot: parsePilot(ps[i] as unknown as readonly unknown[]) }));
}

type Leg = { tokenIn: Address; tokenOut: Address; amountIn: bigint; tickSpacing: number };

/** One pass at a time, so two overlapping cron calls can't send the same rebalance twice. */
export async function runPilots(): Promise<PilotRun> {
  if (!AUTOPILOT) throw new Error("NEXT_PUBLIC_AUTOPILOT_ADDRESS is not set");
  if (g.__apRunning) throw new PilotBusyError("An AutoPilot pass is already running");
  g.__apRunning = true;
  try {
    return await pass(AUTOPILOT);
  } finally {
    g.__apRunning = false;
  }
}

async function pass(ap: Address): Promise<PilotRun> {
  const account = agentAccount();
  if (!account) throw new Error("AUTOPILOT_AGENT_KEY is not set (or equals KEEPER_PRIVATE_KEY)");
  const wallet = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });
  const now = Date.now();
  const closed = marketClosed(now);

  const all = await listPilots(ap);
  const mine = all.filter((p) => p.pilot.on && isAddressEqual(p.pilot.agent, account.address));
  const run: PilotRun = { at: now, checked: mine.length, traded: 0, entries: [] };
  if (!mine.length) return save(run);

  const rows = await contractStocks(ap);
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const prices = await navPrices(rows);
  // Only baskets the contract can fully trade.
  const eligible = new Set(
    BASKETS.filter((b) => b.legs.every((l) => bySym.has(l.symbol) && prices.has(l.symbol)) && b.legs.every((l) => (UNIVERSE as readonly string[]).includes(l.symbol))).map((b) => b.id),
  );
  const board = (await getLeaderboard()).baskets.filter((b) => eligible.has(b.id));

  for (const { user, pilot } of mine) {
    const entry = (action: PilotEntry["action"], text: string, extra: Partial<PilotEntry> = {}) =>
      run.entries.push({ at: Date.now(), user, action, text, ...extra });

    const bals = (await publicClient.multicall({
      allowFailure: false,
      contracts: [USDC_BASE, ...rows.map((r) => r.token)].map((t) => ({ address: ap, abi: autoPilotAbi, functionName: "balances", args: [user, t] }) as const),
    })) as unknown as bigint[];
    const usdc = bals[0];
    const held = new Map<string, { raw: bigint; usd: number }>();
    rows.forEach((r, i) => {
      const raw = bals[i + 1];
      if (raw > 0n) held.set(r.symbol, { raw, usd: (Number(raw) / 10 ** r.decimals) * (prices.get(r.symbol) ?? 0) });
    });
    const heldUsd = Object.fromEntries(BASKETS.map((b) => [b.id, b.legs.reduce((s, l) => s + (held.get(l.symbol)?.usd ?? 0), 0)]));

    const next = pilot.lastTrade ? (pilot.lastTrade + pilot.minInterval) * 1000 : 0;
    if (closed) {
      entry("hold", "Markets are closed and NAV is frozen. AutoPilot waits for the open.");
      continue;
    }
    if (next > now) {
      entry("hold", `Your interval allows the next move at ${new Date(next).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
      continue;
    }
    if (!board.length) {
      entry("skip", "The 7-day NAV board isn't available right now.");
      continue;
    }
    const d = decide({ rules: rulesFromPilot(pilot), board, heldUsd, marketClosed: closed, lastRotateAt: pilot.lastTrade ? pilot.lastTrade * 1000 : undefined, now });
    if (d.action === "hold") {
      entry("hold", d.reason);
      continue;
    }
    const target = BASKETS.find((b) => b.id === d.to)!;
    const keep = new Set(target.legs.map((l) => l.symbol));

    // Sell what doesn't belong in the target basket, biggest first.
    const sells = [...held.entries()]
      .filter(([s, h]) => !keep.has(s) && h.usd >= MIN_SELL_USD)
      .sort((a, b) => b[1].usd - a[1].usd)
      .slice(0, MAX_LEGS - target.legs.length);
    // Spend only what the sells are guaranteed to return (NAV minus the user's slippage cap), so no buy can overdraw.
    // (0.1% extra margin covers rounding between this float math and the contract integer math.)
    const floor = 1 - pilot.maxSlippageBps / 10_000 - 0.001;
    const proceeds = sells.reduce((s, [, h]) => s + BigInt(Math.floor(h.usd * floor * 1e6)), 0n);
    const budget = usdc + proceeds;
    if (budget < BigInt(target.legs.length) * MIN_LEG_USDC) {
      entry("skip", d.action === "buy" ? "Deposit USDC so the agent has something to invest." : `${d.reason} Not enough value to move yet.`);
      continue;
    }

    // Sells first, then buys, each stock once, each in the pool pinned in the contract.
    const legs: Leg[] = [];
    for (const [s, h] of sells) {
      const r = bySym.get(s)!;
      legs.push({ tokenIn: r.token, tokenOut: USDC_BASE, amountIn: h.raw, tickSpacing: r.tickSpacing });
    }
    let spent = 0n;
    for (const [i, l] of target.legs.entries()) {
      const r = bySym.get(l.symbol)!;
      const amt = i === target.legs.length - 1 ? budget - spent : (budget * BigInt(l.weightBps)) / 10_000n;
      if (amt < MIN_LEG_USDC) continue;
      legs.push({ tokenIn: USDC_BASE, tokenOut: r.token, amountIn: amt, tickSpacing: r.tickSpacing });
      spent += amt;
    }
    const data = encodeFunctionData({ abi: autoPilotAbi, functionName: "rebalance", args: [user, legs.map((l) => ({ ...l }))] });
    const tagged = DATA_SUFFIX ? withBuilderCode(data) : data;
    try {
      // Dry run first: a pool trading outside the user's slippage cap would revert, and that shouldn't cost gas.
      await publicClient.call({ account: account.address, to: ap, data: tagged });
    } catch {
      entry("skip", `${d.reason} Held back: pool prices are outside your ${(pilot.maxSlippageBps / 100).toFixed(1)}% slippage cap vs NAV.`);
      continue;
    }
    try {
      const hash = await wallet.sendTransaction({ to: ap, data: tagged });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status === "success") {
        run.traded++;
        entry(d.action, d.reason, { tx: hash });
      } else entry(d.action, d.reason, { tx: hash, error: "reverted" });
    } catch (e) {
      entry(d.action, d.reason, { error: (e as Error).message.slice(0, 160) });
    }
  }
  return save(run);
}

function save(run: PilotRun): PilotRun {
  const log = pilotLog();
  log.unshift(run);
  log.length = Math.min(log.length, LOG_MAX);
  return run;
}
