/**
 * Coinbase Tokenized Stocks API client (public, read-only, no key) + B20 asset ABI.
 * Docs: https://docs.base.org/sdks/tokenized-stocks/overview
 * Reference data only. It does not trade, mint or custody. Swaps go through DEX routes.
 */
import { z } from "zod";
import { formatUnits, type Address, type PublicClient } from "viem";

export const TS_API = "https://api.coinbase.com/v1/tokenized-stocks";

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const TokenSchema = z.object({
  contract_address: addr,
  symbol: z.string(),
  name: z.string(),
  decimals: z.coerce.number(),
  icon_url: z.string().optional(),
  total_supply: z.number().optional(),
  isin: z.string().optional(),
  multiplier: z.number().optional(), // already de-scaled (1.0 = no adjustment)
  paused_features: z.array(z.coerce.number()).optional(),
  nav_price: z.number().optional(), // Chainlink NAV/reference, NOT an execution price
  nav_price_updated_at: z.string().optional(),
  description: z.string().optional(),
  first_mint_date: z.string().optional(),
  adgm_isin: z.string().optional(),
});
export type TokenizedStock = z.infer<typeof TokenSchema>;

const ListSchema = z.object({ tokens: z.array(TokenSchema), next_page_token: z.string().optional() });

export const ChainSchema = z.object({
  chain_id: z.string(),
  chain: z.string(),
  policy_registry_address: addr.optional(),
  token_supply_manager_address: addr.optional(),
  token_factory_address: addr.optional(),
});

export const MetadataSchema = z.object({
  contract_address: addr,
  name: z.string(),
  symbol: z.string(),
  image: z.string().optional(),
  prospectus_url: z.string().optional(),
  description: z.string().optional(),
  adgm_isin: z.string().optional(),
});

export class TokenizedStocksError extends Error {
  constructor(public status: number, public code: number | undefined, message: string) {
    super(message);
  }
}

async function get<T>(path: string, schema: z.ZodType<T>, revalidate = 300): Promise<T> {
  const res = await fetch(`${TS_API}${path}`, {
    headers: { accept: "application/json" },
    next: { revalidate },
  } as RequestInit);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TokenizedStocksError(res.status, body?.code, body?.message ?? `Tokenized Stocks API ${res.status}`);
  }
  return schema.parse(body);
}

/** All listed tokens (follows pagination). Cached 5 min. */
export async function listTokenizedStocks(): Promise<TokenizedStock[]> {
  const out: TokenizedStock[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: "500" });
    if (pageToken) q.set("page_token", pageToken);
    const page = await get(`?${q}`, ListSchema);
    out.push(...page.tokens);
    pageToken = page.next_page_token;
    if (!pageToken) break;
  }
  return out;
}

export const getChains = () => get("/chains", z.object({ chains: z.array(ChainSchema) }), 3600);

/** Ticker must include the suffix, e.g. "TSLAc". Case-insensitive. */
export const getMetadata = (ticker: string) =>
  get(`/metadata/${encodeURIComponent(ticker)}`, MetadataSchema, 3600);

/** Returns a bare number already normalized by decimals. */
export const getTotalSupply = (contract: Address) => get(`/total-supply/${contract}`, z.number(), 300);

/** Resolve basket symbols to live token records. Throws if any symbol is not listed. */
export async function resolveSymbols(symbols: string[]): Promise<TokenizedStock[]> {
  const all = await listTokenizedStocks();
  const bySym = new Map(all.map((t) => [t.symbol.toLowerCase(), t]));
  const missing = symbols.filter((s) => !bySym.has(s.toLowerCase()));
  if (missing.length) throw new Error(`Not listed in Tokenized Stocks API: ${missing.join(", ")}`);
  return symbols.map((s) => bySym.get(s.toLowerCase())!);
}

/** NAV older than this is flagged stale in the UI (feeds hold value outside market hours). */
export const NAV_STALE_MS = 72 * 3600 * 1000;
export function isNavStale(t: TokenizedStock, now = Date.now()) {
  return !t.nav_price || !t.nav_price_updated_at || now - Date.parse(t.nav_price_updated_at) > NAV_STALE_MS;
}

/**
 * B20 asset ABI subset (docs.base.org/specifications/b20/reference/interfaces/ib20-asset).
 * Selectors from the docs: multiplier 0x1b3ed722, scaledBalanceOf 0x1da24f3e,
 * toUIAmount 0x3248d4ff, WAD_PRECISION 0x664808a8.
 * Return types are assumed uint256 (docs don't print full signatures). Verify against base-std IB20Asset.sol.
 */
export const b20Abi = [
  { type: "function", name: "multiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "scaledBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "toUIAmount",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Share-equivalent balance: scaledBalanceOf (= raw * multiplier / 1e18). Never use raw balanceOf as shares. */
export async function readShares(client: PublicClient, token: TokenizedStock, account: Address) {
  const scaled = await client.readContract({
    address: token.contract_address as Address,
    abi: b20Abi,
    functionName: "scaledBalanceOf",
    args: [account],
  });
  const shares = Number(formatUnits(scaled, token.decimals));
  return { scaled, shares, usd: token.nav_price ? shares * token.nav_price : undefined };
}
