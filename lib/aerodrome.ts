/**
 * Direct Aerodrome Slipstream (concentrated liquidity) swaps: USDC → tokenized stock. No API key.
 * Same venue and router as Glacier and Circla on Base mainnet. The Coinbase stock/USDC liquidity
 * sits in these pools, so going direct skips an aggregator without losing depth.
 *
 * Safety: the minimum output comes from the Coinbase Chainlink feed for that stock (published in
 * docs.base.org/specifications/b20/tokenized-stocks-on-base), not from the pool, so a thin or moved
 * pool can't fill far from the reference price. Pools are confirmed against the factory before use.
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE } from "@/lib/constants";

export const AERODROME_ROUTER: Address = getAddress(
  process.env.AERODROME_ROUTER ?? "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F",
);
export const AERODROME_CL_FACTORY: Address = getAddress(
  process.env.AERODROME_CL_FACTORY ?? "0x9CB220581b91b0C83223012FE69688b92aD07a76",
);

/** Deepest USDC pool and Chainlink feed per stock (pools from Glacier's mainnet deploy, feeds from Base docs). */
export const STOCK_ROUTES: Record<string, { pool: Address; feed: Address }> = {
  NVDAc: { pool: "0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  GOOGLc: { pool: "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  METAc: { pool: "0xd072410fa13D242e1d53721Bcf7AF02e3455DC96", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  AAPLc: { pool: "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  MSFTc: { pool: "0x2740C0faAb738F6e346e545fDE02aEF9B1A01ee7", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  TSLAc: { pool: "0x7A33000372f3F028f074182CCb9d16cBEEfBF920", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  AMZNc: { pool: "0x532e0F46d1e528507FC9454d5847C231f23bDDf6", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
};

const poolAbi = [
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const factoryAbi = [
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
      const route = STOCK_ROUTES[leg.symbol];
      if (!route) throw new Error(`No Aerodrome route configured for ${leg.symbol}`);
      const [tickSpacing, t0, t1, round, feedDecimals] = await Promise.all([
        publicClient.readContract({ address: route.pool, abi: poolAbi, functionName: "tickSpacing" }),
        publicClient.readContract({ address: route.pool, abi: poolAbi, functionName: "token0" }),
        publicClient.readContract({ address: route.pool, abi: poolAbi, functionName: "token1" }),
        publicClient.readContract({ address: route.feed, abi: feedAbi, functionName: "latestRoundData" }),
        publicClient.readContract({ address: route.feed, abi: feedAbi, functionName: "decimals" }),
      ]);
      const pair = [t0.toLowerCase(), t1.toLowerCase()];
      if (!pair.includes(USDC_BASE.toLowerCase()) || !pair.includes(leg.token.toLowerCase())) {
        throw new Error(`${leg.symbol}: pool ${route.pool} is not a USDC/${leg.symbol} pool`);
      }
      const canonical = await publicClient.readContract({
        address: AERODROME_CL_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [USDC_BASE, leg.token, tickSpacing],
      });
      if (canonical.toLowerCase() !== route.pool.toLowerCase()) {
        throw new Error(`${leg.symbol}: pool is not registered with the Aerodrome factory`);
      }
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
