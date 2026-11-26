import type { Address } from "viem";

export const BASE_CHAIN_ID = 8453;
/**
 * o1 and 0x routes are off unless NEXT_PUBLIC_ENABLE_AGGREGATOR_ROUTES=1. Their calls go through a generic
 * AllowanceHolder exec that the browser can't fully check, so only Aerodrome (checked call by call) is on by default.
 */
export const AGGREGATORS_ON = process.env.NEXT_PUBLIC_ENABLE_AGGREGATOR_ROUTES === "1";
export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const MIN_PORT_USDC = 5;
/** A dust sweep can buy the basket with less, since the user is cleaning up leftovers. */
export const MIN_DUST_PORT_USDC = 1;
/** Guess: per-port cap to limit damage while liquidity is unproven. Tune after first mainnet tests. */
export const MAX_PORT_USDC = Number(process.env.NEXT_PUBLIC_MAX_PORT_USDC ?? 500);

/**
 * Agent basket as "SYMBOL:weightBps,...". Coinbase tokenized stocks on Base use a `c`
 * suffix (TSLAc, AMDc, GOOGLc), not the `x` suffix in the brief (that is another issuer).
 * Default picks the three tickers reported with live USDC pools and the most DEX volume
 * (NVDAc, GOOGLc, METAc; researched 2026-11-22). Re-check with a real $5 quote per leg.
 */
export const DEFAULT_BASKET = process.env.NEXT_PUBLIC_BASKET ?? "NVDAc:3400,GOOGLc:3300,METAc:3300";

export function parseBasket(spec = DEFAULT_BASKET): { symbol: string; weightBps: number }[] {
  const legs = spec.split(",").map((p) => {
    const [symbol, w] = p.trim().split(":");
    return { symbol, weightBps: Number(w) };
  });
  const total = legs.reduce((s, l) => s + l.weightBps, 0);
  if (legs.length === 0 || total !== 10_000 || legs.some((l) => !l.symbol || !(l.weightBps > 0))) {
    throw new Error(`Invalid basket spec "${spec}": weights must be positive and sum to 10000 bps`);
  }
  return legs;
}
