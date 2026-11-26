/**
 * Rotate: sell everything you hold of one basket's stocks, buy another basket with the USDC.
 *
 * Sells: each leg goes through Aerodrome on our router when it has a pool there, else o1 (if
 * O1_API_KEY). The USDC used for the buy side is the sum of each sell's guaranteed minimum (Aerodrome
 * min out, or the Chainlink price minus slippage for o1), so in an atomic batch the buys can never
 * spend more than the sells produced: if a sell fills worse, the whole batch reverts and nothing moves.
 * Any USDC above the minimum stays in the wallet.
 * Buys: lib/basketQuote.ts (same routes, NAV drift guard, exact approvals).
 */
import { erc20Abi, formatUnits, getAddress, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE, AGGREGATORS_ON } from "@/lib/constants";
import { getBasket, type Basket } from "@/lib/baskets";
import { resolveSymbols } from "@/lib/tokenizedStocks";
import { buildAerodromeSells, feedPrice, findDeepestPool, AERODROME_ROUTER } from "@/lib/aerodrome";
import { createO1SellOrder } from "@/lib/o1";
import { RouteError, quoteBasketBuy, type PortCall, type PortQuote, type Provider } from "@/lib/basketQuote";

export type SellLeg = {
  symbol: string;
  token: Address;
  decimals: number;
  /** Raw token amount sold (the whole balance). */
  amountIn: string;
  /** Guaranteed USDC (6 decimals) this sell contributes to the buy. */
  minUsdc: string;
  provider: Exclude<Provider, "0x">;
};

export type RotateQuote = {
  from: { id: string; name: string };
  to: { id: string; name: string };
  sells: {
    legs: SellLeg[];
    /** Exact-amount approvals of each stock to the contract that sells it. */
    approvals: { token: Address; symbol: string; spender: Address; amount: string }[];
    calls: (PortCall & { provider: Exclude<Provider, "0x"> })[];
  };
  /** USDC (6 decimals) that goes into the buy: the sum of the sells' minimums. */
  usdcIn: string;
  buy: PortQuote;
  expiresAt: number;
};

const APPROVE = "0x095ea7b3";
const MIN_POOL_FOR_SELL = 1_000n * 10n ** 6n;

export async function quoteRotate(p: {
  fromId: string;
  toId: string;
  taker: Address;
  slippageBps?: number;
  maxUsdc: number;
  minUsdc: number;
}): Promise<RotateQuote> {
  const from: Basket = getBasket(p.fromId);
  const to: Basket = getBasket(p.toId);
  if (from.id === to.id) throw new RouteError(400, { error: "same_basket", message: "Pick two different baskets." });
  const slippageBps = p.slippageBps ?? 300;

  const tokens = await resolveSymbols(from.legs.map((l) => l.symbol));
  const balances = await Promise.all(
    tokens.map((t) =>
      publicClient.readContract({ address: getAddress(t.contract_address), abi: erc20Abi, functionName: "balanceOf", args: [p.taker] }),
    ),
  );
  const held = tokens.map((t, i) => ({ t, amount: balances[i] })).filter((x) => x.amount > 0n);
  if (!held.length) {
    throw new RouteError(400, { error: "nothing_to_rotate", message: `You don't hold any ${from.name} stocks yet.` });
  }

  // Route each leg: Aerodrome on our router if its pool is deep enough, else o1.
  const routed = await Promise.all(
    held.map(async ({ t, amount }) => {
      const token = getAddress(t.contract_address);
      const pool = await findDeepestPool(token).catch(() => undefined);
      return { t, token, amount, via: pool && pool.usdc >= MIN_POOL_FOR_SELL ? ("aerodrome" as const) : ("o1" as const) };
    }),
  );
  const noRoute = routed.filter((r) => r.via === "o1" && !(AGGREGATORS_ON && process.env.O1_API_KEY)).map((r) => r.t.symbol);
  if (noRoute.length) {
    throw new RouteError(422, { error: "no_sell_route", symbols: noRoute, message: `No route to sell ${noRoute.join(", ")} right now.` });
  }

  const legs: SellLeg[] = [];
  const approvals: RotateQuote["sells"]["approvals"] = [];
  const calls: RotateQuote["sells"]["calls"] = [];

  const aero = routed.filter((r) => r.via === "aerodrome");
  if (aero.length) {
    const built = await buildAerodromeSells({
      legs: aero.map((r) => ({ symbol: r.t.symbol, token: r.token, decimals: r.t.decimals, amountIn: r.amount })),
      recipient: p.taker,
      slippageBps,
    });
    built.forEach((b, i) => {
      legs.push({ symbol: b.symbol, token: b.token, decimals: aero[i].t.decimals, amountIn: b.amountIn.toString(), minUsdc: b.minUsdc.toString(), provider: "aerodrome" });
      approvals.push({ token: b.token, symbol: b.symbol, spender: AERODROME_ROUTER, amount: b.amountIn.toString() });
      calls.push({ ...b.call, label: `Sell ${b.symbol}`, provider: "aerodrome" });
    });
  }

  for (const r of routed.filter((x) => x.via === "o1")) {
    const price = await feedPrice(r.t.symbol, r.token);
    if (!price) throw new RouteError(422, { error: "no_price", symbols: [r.t.symbol], message: `No reference price for ${r.t.symbol}.` });
    const order = await createO1SellOrder({
      signer: p.taker,
      token: r.token,
      tokenUiAmount: formatUnits(r.amount, r.t.decimals),
      slippageBps,
    });
    if (order.transactions.some((tx) => tx.permit2)) {
      throw new RouteError(422, { error: "o1_permit2_sell", message: `o1 asked for a Permit2 signature to sell ${r.t.symbol}; not supported in Rotate yet.` });
    }
    let spender: Address | undefined;
    const kept = order.transactions.filter((tx) => {
      if (tx.data.slice(0, 10).toLowerCase() !== APPROVE) return true;
      if (getAddress(tx.to) !== r.token) throw new RouteError(502, { error: "o1_unexpected_approve", detail: tx.to });
      spender = getAddress(("0x" + tx.data.slice(34, 74)) as Address);
      return false;
    });
    const usd = (Number(formatUnits(r.amount, r.t.decimals)) * price * (10_000 - slippageBps)) / 10_000;
    legs.push({
      symbol: r.t.symbol,
      token: r.token,
      decimals: r.t.decimals,
      amountIn: r.amount.toString(),
      minUsdc: BigInt(Math.floor(usd * 1e6)).toString(),
      provider: "o1",
    });
    if (spender) approvals.push({ token: r.token, symbol: r.t.symbol, spender, amount: r.amount.toString() });
    kept.forEach((tx, j) =>
      calls.push({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        label: kept.length > 1 ? `Sell ${r.t.symbol} (${j + 1}/${kept.length})` : `Sell ${r.t.symbol}`,
        provider: "o1",
      }),
    );
  }

  const usdcIn = legs.reduce((s, l) => s + BigInt(l.minUsdc), 0n);
  const usd = Number(formatUnits(usdcIn, 6));
  if (usd < p.minUsdc) {
    throw new RouteError(400, { error: "too_small", message: `Your ${from.name} position is worth under $${p.minUsdc}.` });
  }
  if (usd > p.maxUsdc) {
    throw new RouteError(400, { error: "too_large", message: `Rotations are capped at $${p.maxUsdc} during launch.` });
  }

  const buy = await quoteBasketBuy({ legs: to.legs, total: usdcIn, taker: p.taker, slippageBps });
  if (buy.approval && getAddress(buy.approval.token) !== getAddress(USDC_BASE)) {
    throw new RouteError(502, { error: "unexpected_buy_approval" });
  }
  return {
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    sells: { legs, approvals, calls },
    usdcIn: usdcIn.toString(),
    buy,
    expiresAt: Date.now() + 30_000,
  };
}
