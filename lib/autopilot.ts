/**
 * AutoPilot rules engine: turns a user's rules plus live onchain data into one decision.
 * Pure function, no I/O, so the same inputs always give the same answer and anyone can check the reasoning.
 * Inputs: the 7-day basket board (Chainlink NAV, lib/leaderboard.ts), what the wallet holds per basket,
 * the market clock and when the user last rotated.
 */
import type { BasketRow } from "@/lib/leaderboard";

export type AutoRules = {
  autoRotate: boolean; // move into the 7-day leader
  minEdgePct: number; // only when the leader beats your basket by at least this many points
  cutLosers: boolean; // leave a basket that's falling
  cutAtPct: number; // e.g. -5 = rotate out when your basket is down 5% or more over 7 days
  weekendPause: boolean; // no trades while NAV is frozen
  cadenceDays: number; // at most one rotation per this many days
};

export const DEFAULT_RULES: AutoRules = { autoRotate: true, minEdgePct: 2, cutLosers: true, cutAtPct: -5, weekendPause: true, cadenceDays: 7 };

export type AutoDecision =
  | { action: "rotate"; from: string; to: string; rule: "cut" | "rotate"; reason: string }
  | { action: "buy"; to: string; reason: string }
  | { action: "hold"; reason: string };

const pts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

export function decide(p: {
  rules: AutoRules;
  board: BasketRow[];
  heldUsd: Record<string, number>;
  marketClosed: boolean;
  lastRotateAt?: number;
  now: number;
}): AutoDecision {
  const { rules, board, heldUsd } = p;
  if (!board.length) return { action: "hold", reason: "Waiting for the 7-day NAV board." };
  const leader = board.reduce((a, b) => (b.d7 > a.d7 ? b : a));
  const held = board.filter((b) => (heldUsd[b.id] ?? 0) >= 1).sort((a, b) => (heldUsd[b.id] ?? 0) - (heldUsd[a.id] ?? 0));
  const cur = held[0];

  if (!cur) return { action: "buy", to: leader.id, reason: `You don't hold a basket yet. ${leader.name} leads the 7-day board at ${pts(leader.d7)}.` };
  if (rules.weekendPause && p.marketClosed) return { action: "hold", reason: `Markets are closed and NAV is frozen. Your weekend rule holds ${cur.name} until the open.` };

  const sinceDays = p.lastRotateAt ? (p.now - p.lastRotateAt) / 86400_000 : Infinity;
  const cooling = sinceDays < rules.cadenceDays;
  const best = board.filter((b) => b.id !== cur.id).reduce((a, b) => (b.d7 > a.d7 ? b : a));

  if (rules.cutLosers && cur.d7 * 100 <= rules.cutAtPct) {
    if (cooling) return { action: "hold", reason: `${cur.name} is ${pts(cur.d7)} over 7 days, past your ${rules.cutAtPct}% cut rule, but you rotated ${sinceDays.toFixed(1)} days ago (limit: once per ${rules.cadenceDays} days).` };
    return { action: "rotate", from: cur.id, to: best.id, rule: "cut", reason: `${cur.name} is ${pts(cur.d7)} over 7 days, past your ${rules.cutAtPct}% cut rule. Rotating into ${best.name}, the strongest alternative at ${pts(best.d7)}.` };
  }
  if (rules.autoRotate && leader.id !== cur.id) {
    const edge = (leader.d7 - cur.d7) * 100;
    if (edge < rules.minEdgePct) return { action: "hold", reason: `${leader.name} leads ${cur.name} by ${edge.toFixed(2)} pts, under your ${rules.minEdgePct} pt edge. Holding.` };
    if (cooling) return { action: "hold", reason: `${leader.name} leads by ${edge.toFixed(2)} pts, but you rotated ${sinceDays.toFixed(1)} days ago (limit: once per ${rules.cadenceDays} days).` };
    return { action: "rotate", from: cur.id, to: leader.id, rule: "rotate", reason: `${leader.name} (${pts(leader.d7)}) leads your ${cur.name} (${pts(cur.d7)}) by ${edge.toFixed(2)} pts over 7 days, above your ${rules.minEdgePct} pt edge. Rotating.` };
  }
  return { action: "hold", reason: leader.id === cur.id ? `${cur.name} already leads the 7-day board at ${pts(cur.d7)}. Holding.` : `${cur.name} at ${pts(cur.d7)}. No rule says move. Holding.` };
}
