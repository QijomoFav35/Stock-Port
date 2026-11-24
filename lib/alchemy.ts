/**
 * Alchemy on Base (server-side only: ALCHEMY_API_KEY). Used by the dust scan.
 *   Token API:  alchemy_getTokenBalances, alchemy_getTokenMetadata (JSON-RPC)
 *   Prices API: POST https://api.g.alchemy.com/prices/v1/{key}/tokens/by-address (max 25 addresses)
 */
import { getAddress, type Address } from "viem";

const NETWORK = "base-mainnet";

function key() {
  const k = process.env.ALCHEMY_API_KEY;
  if (!k) throw new Error("ALCHEMY_API_KEY is not set");
  return k;
}

async function rpc<T>(calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  const res = await fetch(`https://${NETWORK}.g.alchemy.com/v2/${key()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))),
  });
  if (!res.ok) throw new Error(`Alchemy ${res.status}`);
  const body = (await res.json()) as { id: number; result?: T; error?: { message: string } }[];
  const byId = new Map(body.map((r) => [r.id, r]));
  return calls.map((_, id) => {
    const r = byId.get(id);
    if (!r || r.error) throw new Error(`Alchemy: ${r?.error?.message ?? "missing result"}`);
    return r.result as T;
  });
}

/** Every ERC-20 the owner holds with a non-zero balance (raw units). */
export async function getTokenBalances(owner: Address): Promise<{ token: Address; raw: bigint }[]> {
  const out: { token: Address; raw: bigint }[] = [];
  let pageKey: string | undefined;
  for (let i = 0; i < 10; i++) {
    const params: unknown[] = [owner, "erc20"];
    if (pageKey) params.push({ pageKey });
    const [page] = await rpc<{ tokenBalances: { contractAddress: string; tokenBalance: string | null }[]; pageKey?: string }>([
      { method: "alchemy_getTokenBalances", params },
    ]);
    for (const b of page.tokenBalances) {
      const raw = b.tokenBalance ? BigInt(b.tokenBalance) : 0n;
      if (raw > 0n) out.push({ token: getAddress(b.contractAddress), raw });
    }
    pageKey = page.pageKey;
    if (!pageKey) break;
  }
  return out;
}

export type TokenMeta = { name?: string; symbol?: string; decimals?: number; logo?: string };

export async function getTokenMetadata(tokens: Address[]): Promise<TokenMeta[]> {
  if (!tokens.length) return [];
  return rpc<TokenMeta>(tokens.map((t) => ({ method: "alchemy_getTokenMetadata", params: [t] })));
}

/** USD price per whole token, or undefined when Alchemy has none (usually spam or brand new tokens). */
export async function getUsdPrices(tokens: Address[]): Promise<Map<Address, number>> {
  const prices = new Map<Address, number>();
  for (let i = 0; i < tokens.length; i += 25) {
    const chunk = tokens.slice(i, i + 25);
    const res = await fetch(`https://api.g.alchemy.com/prices/v1/${key()}/tokens/by-address`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ addresses: chunk.map((address) => ({ network: NETWORK, address })) }),
    });
    if (!res.ok) throw new Error(`Alchemy prices ${res.status}`);
    const body = (await res.json()) as {
      data: { address: string; prices?: { currency: string; value: string }[]; error?: unknown }[];
    };
    for (const d of body.data ?? []) {
      const usd = d.prices?.find((p) => p.currency.toLowerCase() === "usd");
      const v = usd ? Number(usd.value) : NaN;
      if (Number.isFinite(v) && v > 0) prices.set(getAddress(d.address), v);
    }
  }
  return prices;
}
