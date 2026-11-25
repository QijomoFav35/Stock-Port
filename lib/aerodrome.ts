/**
 * Direct Aerodrome Slipstream (concentrated liquidity) swaps: USDC → tokenized stock. No API key.
 * Uses Aerodrome's Slipstream swap router (the one Circla integrates). 0x is the fallback route and
 * can reach pools on other Aerodrome factories too.
 *
 * Safety: the minimum output comes from the Coinbase Chainlink feed for that stock (published in
 * docs.base.org/specifications/b20/tokenized-stocks-on-base), not from the pool, so a thin or moved
 * pool can't fill far from the reference price. Pools come from the router's own factory.
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE } from "@/lib/constants";
import { getNavFeeds } from "@/lib/tokenizedStocks";

export const AERODROME_ROUTER: Address = getAddress(
  process.env.AERODROME_ROUTER ?? "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F",
);
/**
 * Chainlink feed per stock (docs.base.org/specifications/b20/tokenized-stocks-on-base).
 * Pools are NOT hard-coded: Aerodrome has more than one CL factory on Base and a router only
 * swaps through pools of its own factory. We ask the router for its factory, then pick the
 * USDC pool with the most USDC across that factory's tick spacings.
 */
export const STOCK_FEEDS: Record<string, Address> = {
  NVDAc: "0x04689a41629776563E6822F76f2e57D148d28513",
  GOOGLc: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  METAc: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  AAPLc: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  MSFTc: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  TSLAc: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
  AMZNc: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
};

/** Feed for a stock: the pinned address above, else the one the Tokenized Stocks API lists. */
export async function feedFor(symbol: string, token: Address): Promise<Address | undefined> {
  return STOCK_FEEDS[symbol] ?? (await getNavFeeds().catch(() => undefined))?.get(token.toLowerCase());
}

/** Skip pools thinner than this (USDC, 6 decimals). The Chainlink floor on min-out still protects every buy. */
const MIN_POOL_USDC = 1_000n * 10n ** 6n;
const FALLBACK_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000];

const routerFactoryAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const balanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const factoryAbi = [
  {
    type: "function",
    name: "tickSpacings",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "int24[]" }],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int24" }],
    outputs: [{ type: "address" }],
  },
] as const;
const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint80", name: "roundId" },
      { type: "int256", name: "answer" },
      { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" },
      { type: "uint80", name: "answeredInRound" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
export const slipstreamRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { type: "address", name: "tokenIn" },
          { type: "address", name: "tokenOut" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "recipient" },
          { type: "uint256", name: "deadline" },
          { type: "uint256", name: "amountIn" },
          { type: "uint256", name: "amountOutMinimum" },
          { type: "uint160", name: "sqrtPriceLimitX96" },
        ],
      },
    ],
    outputs: [{ type: "uint256", name: "amountOut" }],
  },
] as const;

export type AerodromeLeg = {
  symbol: string;
  token: Address;
  usdcIn: bigint;
  minOut: bigint;
  refPrice: number;
  feedUpdatedAt: number;
  call: { to: Address; data: Hex; value: Hex };
};

/** Builds one exactInputSingle per leg. Throws if any leg has no verified pool or a bad feed. */
export async function buildAerodromeBuys(p: {
  legs: { symbol: string; token: Address; decimals: number; usdcIn: bigint }[];
  recipient: Address;
  slippageBps: number;
}): Promise<AerodromeLeg[]> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  return Promise.all(
    p.legs.map(async (leg) => {
      const feed = await feedFor(leg.symbol, leg.token);
      if (!feed) throw new Error(`No price feed configured for ${leg.symbol}`);
      const [best, round, feedDecimals] = await Promise.all([
        findDeepestPool(leg.token),
        publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
        publicClient.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
      ]);
      if (!best) throw new Error(`${leg.symbol}: no Aerodrome USDC pool with enough liquidity`);
      const tickSpacing = best.tickSpacing;
      const answer = round[1];
      if (answer <= 0n) throw new Error(`${leg.symbol}: price feed returned no price`);

      // tokens out = usdcIn / price. USDC has 6 decimals; the feed has `feedDecimals`; the stock `leg.decimals`.
      // Feeds report price per token, so the B20 multiplier is NOT applied again (same as Glacier).
      const expected = (leg.usdcIn * 10n ** BigInt(leg.decimals + feedDecimals)) / (answer * 10n ** 6n);
      const minOut = (expected * BigInt(10_000 - p.slippageBps)) / 10_000n;

      const data = encodeFunctionData({
        abi: slipstreamRouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: USDC_BASE,
            tokenOut: leg.token,
            tickSpacing,
            recipient: p.recipient,
            deadline,
            amountIn: leg.usdcIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      return {
        symbol: leg.symbol,
        token: leg.token,
        usdcIn: leg.usdcIn,
        minOut,
        refPrice: Number(answer) / 10 ** feedDecimals,
        feedUpdatedAt: Number(round[3]),
        call: { to: AERODROME_ROUTER, data, value: "0x0" as Hex },
      };
    }),
  );
}

let factoryPromise: Promise<Address> | undefined;
/** The CL factory this router swaps through (read on chain, cached per server process). */
export function routerFactory(): Promise<Address> {
  factoryPromise ??= publicClient
    .readContract({ address: AERODROME_ROUTER, abi: routerFactoryAbi, functionName: "factory" })
    .catch((e) => {
      factoryPromise = undefined;
      throw e;
    });
  return factoryPromise;
}

/** The router-compatible USDC/stock pool holding the most USDC, or undefined if none is deep enough. */
export async function findDeepestPool(
  token: Address,
): Promise<{ pool: Address; tickSpacing: number; usdc: bigint } | undefined> {
  const factory = await routerFactory();
  const spacings = await publicClient
    .readContract({ address: factory, abi: factoryAbi, functionName: "tickSpacings" })
    .then((t) => t.map(Number))
    .catch(() => FALLBACK_TICK_SPACINGS);
  const found = await Promise.all(
    spacings.map(async (tickSpacing) => {
      const pool = await publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [USDC_BASE, token, tickSpacing],
      });
      if (/^0x0{40}$/i.test(pool)) return undefined;
      const usdc = await publicClient.readContract({ address: USDC_BASE, abi: balanceAbi, functionName: "balanceOf", args: [pool] });
      return { pool: getAddress(pool), tickSpacing, usdc };
    }),
  );
  const pools = found.filter((p): p is NonNullable<typeof p> => !!p && p.usdc >= MIN_POOL_USDC);
  return pools.sort((a, b) => (b.usdc > a.usdc ? 1 : b.usdc < a.usdc ? -1 : 0))[0];
}
