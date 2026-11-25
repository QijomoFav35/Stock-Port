/** Peg health types and labels. Safe in the browser; the onchain reads live in lib/pegHealth.ts. */
import type { Address } from "viem";

/** Refuse buys when the pool is further than this from the reference (NAV), in %. */
export const NAV_DRIFT_MAX_PCT = Number(process.env.NEXT_PUBLIC_NAV_DRIFT_MAX_PCT || 2);
/** Set NEXT_PUBLIC_NAV_DRIFT_MAX_PCT=0 to turn the guard off (chips still show the spread). */
export const DRIFT_GUARD_ON = Number.isFinite(NAV_DRIFT_MAX_PCT) && NAV_DRIFT_MAX_PCT > 0;
/** Show "Watch" from here up to the max. */
export const NAV_DRIFT_WATCH_PCT = DRIFT_GUARD_ON ? Math.min(1, NAV_DRIFT_MAX_PCT) : 1;

export type PegStatus = "healthy" | "watch" | "paused" | "stale" | "unknown";
export type PegHealth = {
  symbol: string;
  status: PegStatus;
  /** USDC per share in the pool. */
  poolPrice?: number;
  /** Chainlink reference (NAV) per share. */
  refPrice?: number;
  /** (pool - ref) / ref * 100. Positive = pool trades above NAV. */
  spreadPct?: number;
  /** Unix ms of the last reference update. */
  refUpdatedAt?: number;
  pool?: Address;
};

export function pegStatus(spreadPct: number): PegStatus {
  const a = Math.abs(spreadPct);
  if (!DRIFT_GUARD_ON) return a > 1 ? "watch" : "healthy";
  return a > NAV_DRIFT_MAX_PCT ? "paused" : a > NAV_DRIFT_WATCH_PCT ? "watch" : "healthy";
}

export const PEG_LABEL: Record<PegStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  paused: "Paused",
  stale: "NAV stale",
  unknown: "No data",
};

/** Chip colors from the Base palette. */
export const PEG_STYLE: Record<PegStatus, { background: string; color: string }> = {
  healthy: { background: "#B6F569", color: "#0A0B0D" },
  watch: { background: "#FFD12F", color: "#0A0B0D" },
  paused: { background: "#FC401F", color: "#FFFFFF" },
  stale: { background: "#EEF0F3", color: "#5B616E" },
  unknown: { background: "#EEF0F3", color: "#5B616E" },
};

/** "+0.3% vs NAV", or "" when there's no spread. */
export function spreadText(p?: PegHealth) {
  if (!p || p.spreadPct === undefined) return "";
  const s = p.spreadPct;
  return `${s > 0 ? "+" : ""}${s.toFixed(Math.abs(s) < 10 ? 1 : 0)}% vs NAV`;
}

/** Legs the drift guard refuses. */
export const driftBlocked = (pegs: PegHealth[]) => pegs.filter((p) => p.status === "paused");
