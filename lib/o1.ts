/**
 * o1 Exchange Trading API (server-side only: bearer token).
 * Docs: https://docs.o1.exchange/api/trading
 *   POST https://api.o1.exchange/api/v2/order          create order → unsigned txs (+ optional Permit2 EIP-712)
 *   POST https://api.o1.exchange/api/v2/order/complete submit signed raw txs (not used: browser wallets
 *        can't eth_signTransaction, so the user's wallet broadcasts the calls itself; see README)
 */
import { getAddress, parseTransaction, toHex, type Address, type Hex } from "viem";
import { BASE_CHAIN_ID, USDC_BASE } from "./constants";

export const O1_API = process.env.O1_API_BASE_URL ?? "https://api.o1.exchange";

/** Fixed dummy signature o1 puts in `data` where the Permit2 signature goes (from o1 docs). */
export const O1_SIGNATURE_PLACEHOLDER =
  "42f68902113a2a579bcc207c91254c8516d921250e748c18a082d91d74908f8e9a05f27b72a030c6a42d77d0e0aab6fb09219b01a01e7b5b24e4f322ee1762ff1b";

export type Eip712 = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  values: Record<string, unknown>;
};

export type O1Tx = { id: string; to: Address; data: Hex; value: Hex; gasLimit?: Hex; permit2?: Eip712 };
export type O1Order = { id: string; transactions: O1Tx[] };

type RawUnsigned = string | { to: string; data: string; value?: string | number; gasLimit?: string | number; chainId?: number };

/**
 * o1 docs show `unsigned` as an object {to,data,value,gasLimit,chainId}. The team brief says it is an
 * RLP-serialized hex string. Handle both.
 */
function normalizeUnsigned(u: RawUnsigned): Pick<O1Tx, "to" | "data" | "value" | "gasLimit"> {
  if (typeof u === "string") {
    const tx = parseTransaction(u as Hex);
    if (!tx.to) throw new Error("o1 returned a transaction with no `to`");
    return { to: getAddress(tx.to), data: tx.data ?? "0x", value: toHex(tx.value ?? 0n), gasLimit: tx.gas ? toHex(tx.gas) : undefined };
  }
  if (u.chainId !== undefined && Number(u.chainId) !== BASE_CHAIN_ID) {
    throw new Error(`o1 returned a tx for chain ${u.chainId}, expected ${BASE_CHAIN_ID}`);
  }
  return {
    to: getAddress(u.to),
    data: u.data as Hex,
    value: toHex(BigInt(u.value ?? 0)),
    gasLimit: u.gasLimit !== undefined ? toHex(BigInt(u.gasLimit)) : undefined,
  };
}

export async function createO1BuyOrder(p: {
  signer: Address;
  token: Address;
  /** Human-readable USDC amount to spend (o1 `uiAmount`). Semantics for USDC-quoted buys are inferred: verify with $5. */
  usdcUiAmount: string;
  slippageBps?: number;
}): Promise<O1Order> {
  const key = process.env.O1_API_KEY;
  if (!key) throw new Error("O1_API_KEY is not set");
  const res = await fetch(`${O1_API}/api/v2/order`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      networkId: BASE_CHAIN_ID,
      signerAddress: p.signer,
      tokenAddress: p.token,
      quoteTokenAddress: USDC_BASE,
      uiAmount: p.usdcUiAmount,
      direction: "buy",
      slippageBps: p.slippageBps ?? 300,
      mevProtection: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(`o1 order failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const txs = (body.transactions ?? []) as { id: string; unsigned: RawUnsigned; permit2?: { eip712?: Eip712 } }[];
  if (!txs.length) throw new Error("o1 returned no transactions");
  return {
    id: String(body.id),
    transactions: txs.map((t) => ({ id: t.id, ...normalizeUnsigned(t.unsigned), permit2: t.permit2?.eip712 })),
  };
}
