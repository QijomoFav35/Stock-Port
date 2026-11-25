/**
 * Basket buy quoting, shared by POST /api/swap/quote and POST /api/swap/rotate.
 *
 * Provider order: Aerodrome direct (default, no key), then 0x (if ZEROX_API_KEY), then o1 (if O1_API_KEY).
 * If one fails for any leg, the whole basket is re-quoted with the next, so a buy never dies on one
 * route. SWAP_PROVIDER picks a different first choice. A caller can force one provider (e.g. smart
 * wallets can't sign o1's Permit2 legs); a forced provider gets no fallback.
 * The Builder Code suffix is added client-side at send time (lib/attribution.ts).
 * Peg guard: if any leg's pool is more than NAV_DRIFT_MAX_PCT off its Chainlink reference, the buy is
 * refused with 409 peg_drift (lib/pegHealth.ts). Every quote carries `peg` so the review sheet can show it.
 */
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { USDC_BASE, USDC_DECIMALS } from "@/lib/constants";
import type { Leg } from "@/lib/baskets";
import { resolveSymbols, type TokenizedStock } from "@/lib/tokenizedStocks";
import { getZeroExQuote } from "@/lib/zeroEx";
import { createO1BuyOrder, type Eip712 } from "@/lib/o1";
import { AERODROME_ROUTER, buildAerodromeBuys } from "@/lib/aerodrome";
import { getPegHealth } from "@/lib/pegHealth";
import { NAV_DRIFT_MAX_PCT, driftBlocked, type PegHealth } from "@/lib/peg";

/** Canonical Uniswap Permit2 (same address on every chain). */
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type Provider = "aerodrome" | "o1" | "0x";
const available = (p: Provider) =>
  p === "aerodrome" ? true : Boolean(p === "o1" ? process.env.O1_API_KEY : process.env.ZEROX_API_KEY);

export type PortCall = { to: Address; data: Hex; value: Hex; label: string; permit2?: Eip712 };
export type PortQuote = {
  provider: Provider;
  /** Set when the default provider failed and this quote came from the backup. */
  fallback?: { from: Provider; reason: string };
  /** ERC-20 approval the client adds only if current allowance is short. */
  approval?: { token: Address; spender: Address; amount: string };
  calls: PortCall[];
  legs: { symbol: string; token: Address; sellAmount: string; buyAmount?: string; minBuyAmount?: string; decimals: number; orderId?: string }[];
  totalUsdc: string;
  expiresAt: number;
  /** Pool vs NAV per basket leg, same order as `legs`. */
  peg: PegHealth[];
};

export class RouteError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error));
  }
}

/**
 * Quote buying `legs` (weights in bps) with `total` USDC (6 decimals) for `taker`.
 * Throws RouteError(409 peg_drift) when a leg's pool is off NAV, or the first provider error when no route works.
 */
export async function quoteBasketBuy(p: {
  legs: Leg[];
  total: bigint;
  taker: Address;
  slippageBps?: number;
  forced?: Provider;
}): Promise<PortQuote> {
  const { legs: basket, total, taker, slippageBps, forced } = p;
  const tokens = await resolveSymbols(basket.map((b) => b.symbol));

  // NAV drift guard: don't buy into a pool that has slipped off its reference price.
  const peg = await getPegHealth(tokens);
  const off = driftBlocked(peg);
  if (off.length) {
    const detail = off.map((x) => `${x.symbol} ${x.spreadPct!.toFixed(1)}%`).join(", ");
    throw new RouteError(409, {
      error: "peg_drift",
      symbols: off.map((x) => x.symbol),
      maxPct: NAV_DRIFT_MAX_PCT,
      peg,
      message: `Paused: pool price is more than ${NAV_DRIFT_MAX_PCT}% off NAV (${detail}). Try again once it's back in range.`,
    });
  }

  // Split by weight; the last leg takes the rounding remainder so legs sum exactly to total.
  let allocated = 0n;
  const sells = basket.map((b, i) => {
    const s = i === basket.length - 1 ? total - allocated : (total * BigInt(b.weightBps)) / 10_000n;
    allocated += s;
    return s;
  });

  const first = (forced ?? process.env.SWAP_PROVIDER ?? "aerodrome") as Provider;
  const order: Provider[] = forced
    ? [forced]
    : [first, ...(["aerodrome", "0x", "o1"] as Provider[]).filter((x) => x !== first)].filter(available);
  const run = (x: Provider) =>
    x === "aerodrome"
      ? quoteAerodrome(basket.map((b) => b.symbol), tokens, sells, taker, slippageBps)
      : x === "o1"
        ? quoteO1(tokens, sells, taker, slippageBps)
        : quote0x(tokens, sells, taker, slippageBps);

  let quote: Omit<PortQuote, "totalUsdc" | "expiresAt" | "peg"> | undefined;
  let firstError: unknown;
  for (const x of order) {
    try {
      const q = await run(x);
      quote = firstError ? { ...q, fallback: { from: order[0], reason: errText(firstError).slice(0, 200) } } : q;
      break;
    } catch (e) {
      console.warn(`[quote] ${x} failed: ${errText(e)}`);
      firstError ??= e;
    }
  }
  if (!quote) throw firstError ?? new Error("No swap route available");
  return { ...quote, totalUsdc: total.toString(), expiresAt: Date.now() + 30_000, peg };
}

export function errText(e: unknown) {
  return e instanceof RouteError ? JSON.stringify(e.body) : (e as Error)?.message ?? String(e);
}

async function quoteAerodrome(
  symbols: string[],
  tokens: TokenizedStock[],
  sells: bigint[],
  taker: Address,
  slippageBps?: number,
) {
  const legs = await buildAerodromeBuys({
    legs: tokens.map((t, i) => ({
      symbol: symbols[i],
      token: getAddress(t.contract_address),
      decimals: t.decimals,
      usdcIn: sells[i],
    })),
    recipient: taker,
    slippageBps: slippageBps ?? 300,
  });
  const total = sells.reduce((a, b) => a + b, 0n);
  return {
    provider: "aerodrome" as const,
    approval: { token: USDC_BASE, spender: AERODROME_ROUTER, amount: total.toString() },
    calls: legs.map((l) => ({ ...l.call, label: `Buy ${l.symbol}` })),
    legs: legs.map((l, i) => ({
      symbol: l.symbol,
      token: l.token,
      sellAmount: l.usdcIn.toString(),
      minBuyAmount: l.minOut.toString(),
      decimals: tokens[i].decimals,
    })),
  };
}

async function quoteO1(tokens: TokenizedStock[], sells: bigint[], taker: Address, slippageBps?: number) {
  const orders = await Promise.all(
    tokens.map((t, i) =>
      createO1BuyOrder({
        signer: taker,
        token: getAddress(t.contract_address),
        usdcUiAmount: formatUnits(sells[i], USDC_DECIMALS),
        slippageBps,
      }),
    ),
  );
  // o1 returns [USDC approve (unlimited), swap] per leg. We never forward its approve: the client adds
  // one exact-amount approval for the whole basket instead (see `approval` below and lib/txGuard.ts).
  const APPROVE = "0x095ea7b3";
  const spenders = new Set<string>();
  const calls: PortCall[] = orders.flatMap((o, i) => {
    const kept = o.transactions.filter((tx) => {
      const isApprove = tx.data.slice(0, 10).toLowerCase() === APPROVE;
      if (!isApprove) return true;
      if (getAddress(tx.to) !== getAddress(USDC_BASE)) {
        throw new RouteError(502, { error: "o1_unexpected_approve", detail: tx.to });
      }
      spenders.add(getAddress(("0x" + tx.data.slice(34, 74)) as Address));
      return false;
    });
    return kept.map((tx, j) => ({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      permit2: tx.permit2,
      label: kept.length > 1 ? `Buy ${tokens[i].symbol} (${j + 1}/${kept.length})` : `Buy ${tokens[i].symbol}`,
    }));
  });
  if (spenders.size > 1) throw new RouteError(502, { error: "o1_inconsistent_spender" });
  const total = sells.reduce((a, b) => a + b, 0n);
  const usesPermit2 = calls.some((c) => c.permit2);
  const spender = spenders.size ? ([...spenders][0] as Address) : usesPermit2 ? PERMIT2 : undefined;
  return {
    provider: "o1" as const,
    approval: spender ? { token: USDC_BASE, spender, amount: total.toString() } : undefined,
    calls,
    legs: tokens.map((t, i) => ({
      symbol: t.symbol,
      token: getAddress(t.contract_address),
      sellAmount: sells[i].toString(),
      decimals: t.decimals,
      orderId: orders[i].id,
    })),
  };
}

async function quote0x(tokens: TokenizedStock[], sells: bigint[], taker: Address, slippageBps?: number) {
  const quotes = await Promise.all(
    tokens.map((t, i) =>
      getZeroExQuote({ sellToken: USDC_BASE, buyToken: getAddress(t.contract_address), sellAmount: sells[i], taker, slippageBps }),
    ),
  );
  const noLiq = tokens.filter((_, i) => !quotes[i].liquidityAvailable).map((t) => t.symbol);
  if (noLiq.length) throw new RouteError(422, { error: "no_liquidity", symbols: noLiq });

  // AllowanceHolder is both the spender and the tx target for every leg.
  const spender = getAddress(quotes[0].transaction.to);
  if (quotes.some((q) => getAddress(q.transaction.to) !== spender)) {
    throw new RouteError(502, { error: "inconsistent_spender" });
  }
  const total = sells.reduce((a, b) => a + b, 0n);
  return {
    provider: "0x" as const,
    approval: { token: USDC_BASE, spender, amount: total.toString() },
    calls: quotes.map((q, i) => ({
      to: spender,
      data: q.transaction.data,
      value: ("0x" + BigInt(q.transaction.value || "0").toString(16)) as Hex,
      label: `Buy ${tokens[i].symbol}`,
    })),
    legs: tokens.map((t, i) => ({
      symbol: t.symbol,
      token: getAddress(t.contract_address),
      sellAmount: sells[i].toString(),
      buyAmount: quotes[i].buyAmount,
      minBuyAmount: quotes[i].minBuyAmount,
      decimals: t.decimals,
    })),
  };
}
