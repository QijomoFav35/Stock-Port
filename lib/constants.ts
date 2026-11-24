import type { Address } from "viem";

export const BASE_CHAIN_ID = 8453;
export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const MIN_PORT_USDC = 5;
/** A dust sweep can buy the basket with less, since the user is cleaning up leftovers. */
export const MIN_DUST_PORT_USDC = 1;
/** Dust scan lists priced tokens up to this USD value; the UI threshold chips filter further. */
export const DUST_MAX_USD = 1000;
/** Skip a dust token if its swap would lose more than this share of its value (Rabby uses 10%). */
export const DUST_MAX_IMPACT_BPS = 1000;
/** Skip a dust token if its swap gas costs more than this (Rabby uses $0.10 on L2s). */
export const DUST_MAX_GAS_USD = 0.1;
/** Most tokens one sweep handles. */
export const DUST_MAX_TOKENS = 20;
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
