/**
 * AutoPilot (contracts/AutoPilot.sol): you set the rules, the agent trades your deposit inside them.
 * The contract has no owner. Only the agent you pick can trade, only USDC to an allowed stock and back,
 * never more often than your interval, and every swap must return at least Chainlink NAV minus your
 * slippage cap. It never trades while US markets are closed, waits at least a day between trades, uses one pinned
 * pool per stock, and allows each stock once per rebalance (sells, then buys). Withdraw or exit() any time.
 *
 * Set NEXT_PUBLIC_AUTOPILOT_ADDRESS (and NEXT_PUBLIC_AUTOPILOT_FROM_BLOCK) after deploying from /deploy-autopilot.
 */
import { getAddress, isAddress, type Address } from "viem";
import type { AutoRules } from "@/lib/autopilot";

const raw = process.env.NEXT_PUBLIC_AUTOPILOT_ADDRESS ?? "";
export const AUTOPILOT: Address | undefined = isAddress(raw) ? getAddress(raw) : undefined;
export const AUTOPILOT_FROM_BLOCK = BigInt(process.env.NEXT_PUBLIC_AUTOPILOT_FROM_BLOCK || "0");

/** Same limits as the contract. */
export const AP_MAX_SLIPPAGE_PCT = 3;
export const AP_MIN_DEPOSIT_USDC = 1;

export type OnchainPilot = {
  agent: Address;
  on: boolean;
  autoRotate: boolean;
  cutLosers: boolean;
  weekendPause: boolean;
  maxSlippageBps: number;
  minEdgeBps: number;
  cutAtBps: number;
  minInterval: number;
  lastTrade: number;
};

/** The rules a user sees, plus their slippage cap, as setPilot arguments. Interval is at least one day in the app. */
export function pilotArgs(agent: Address, on: boolean, rules: AutoRules, slippagePct: number) {
  const days = Math.max(1, Math.round(rules.cadenceDays));
  return [
    agent,
    on,
    rules.autoRotate,
    rules.cutLosers,
    rules.weekendPause,
    Math.min(AP_MAX_SLIPPAGE_PCT * 100, Math.max(10, Math.round(slippagePct * 100))),
    Math.min(65_535, Math.max(0, Math.round(rules.minEdgePct * 100))),
    Math.min(9000, Math.max(0, Math.round(Math.abs(rules.cutAtPct) * 100))),
    days * 86_400,
  ] as const;
}

/** Onchain pilot back to the app's rule shape (what the agent will actually follow). */
export function rulesFromPilot(p: OnchainPilot): AutoRules {
  return {
    autoRotate: p.autoRotate,
    minEdgePct: p.minEdgeBps / 100,
    cutLosers: p.cutLosers,
    cutAtPct: -p.cutAtBps / 100,
    weekendPause: p.weekendPause,
    cadenceDays: p.minInterval / 86_400,
  };
}

export const parsePilot = (r: readonly unknown[]): OnchainPilot => ({
  agent: r[0] as Address,
  on: r[1] as boolean,
  autoRotate: r[2] as boolean,
  cutLosers: r[3] as boolean,
  weekendPause: r[4] as boolean,
  maxSlippageBps: Number(r[5]),
  minEdgeBps: Number(r[6]),
  cutAtBps: Number(r[7]),
  minInterval: Number(r[8]),
  lastTrade: Number(r[9]),
});

const leg = {
  type: "tuple",
  components: [
    { type: "address", name: "tokenIn" },
    { type: "address", name: "tokenOut" },
    { type: "uint256", name: "amountIn" },
    { type: "int24", name: "tickSpacing" },
  ],
} as const;

export const autoPilotAbi = [
  {
    type: "function",
    name: "setPilot",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "agent" },
      { type: "bool", name: "on" },
      { type: "bool", name: "autoRotate" },
      { type: "bool", name: "cutLosers" },
      { type: "bool", name: "weekendPause" },
      { type: "uint16", name: "maxSlippageBps" },
      { type: "uint16", name: "minEdgeBps" },
      { type: "uint16", name: "cutAtBps" },
      { type: "uint32", name: "minInterval" },
    ],
    outputs: [],
  },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }, { type: "uint256", name: "amount" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }, { type: "uint256", name: "amount" }], outputs: [] },
  { type: "function", name: "exit", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "rebalance", stateMutability: "nonpayable", inputs: [{ type: "address", name: "user" }, { ...leg, type: "tuple[]", name: "legs" }], outputs: [] },
  {
    type: "function",
    name: "pilots",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "address", name: "agent" },
      { type: "bool", name: "on" },
      { type: "bool", name: "autoRotate" },
      { type: "bool", name: "cutLosers" },
      { type: "bool", name: "weekendPause" },
      { type: "uint16", name: "maxSlippageBps" },
      { type: "uint16", name: "minEdgeBps" },
      { type: "uint16", name: "cutAtBps" },
      { type: "uint32", name: "minInterval" },
      { type: "uint64", name: "lastTrade" },
    ],
  },
  {
    type: "function",
    name: "stocks",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "address", name: "feed" },
      { type: "uint8", name: "decimals" },
      { type: "uint8", name: "feedDecimals" },
      { type: "bool", name: "allowed" },
      { type: "int24", name: "tickSpacing" },
    ],
  },
  { type: "function", name: "balances", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stockList", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "stockCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "users", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "userCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rebalanceCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextTradeAt", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "Traded",
    inputs: [
      { type: "address", name: "user", indexed: true },
      { type: "address", name: "tokenIn", indexed: true },
      { type: "address", name: "tokenOut", indexed: true },
      { type: "uint256", name: "amountIn", indexed: false },
      { type: "uint256", name: "amountOut", indexed: false },
      { type: "uint256", name: "minOut", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Rebalanced",
    inputs: [
      { type: "address", name: "user", indexed: true },
      { type: "address", name: "agent", indexed: true },
      { type: "uint256", name: "legs", indexed: false },
    ],
  },
] as const;
