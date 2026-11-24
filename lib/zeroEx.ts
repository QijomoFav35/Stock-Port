/**
 * 0x Swap API v2 (AllowanceHolder flow) on Base. Server-side only: uses ZEROX_API_KEY.
 * https://0x.org/docs/api#tag/Swap/operation/swap::allowanceHolder::getQuote
 */
import type { Address, Hex } from "viem";
import { BASE_CHAIN_ID } from "./constants";

export type ZeroExQuote = {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  issues?: { allowance?: { actual: string; spender: Address } | null; balance?: unknown };
  transaction: { to: Address; data: Hex; value: string; gas?: string; gasPrice?: string };
  route?: unknown;
};

export async function getZeroExQuote(p: {
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  taker: Address;
  slippageBps?: number;
}): Promise<ZeroExQuote> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) throw new Error("ZEROX_API_KEY is not set");
  const q = new URLSearchParams({
    chainId: String(BASE_CHAIN_ID),
    sellToken: p.sellToken,
    buyToken: p.buyToken,
    sellAmount: p.sellAmount.toString(),
    taker: p.taker,
    slippageBps: String(p.slippageBps ?? 100),
  });
  const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${q}`, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`0x quote failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return body as ZeroExQuote;
}
