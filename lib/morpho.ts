/**
 * Borrow USDC against tokenized stocks on Morpho (Base).
 *
 * Markets are Morpho Blue isolated markets curated by Steakhouse Financial, priced by Chainlink.
 * Every parameter below was read onchain with idToMarketParams(id) and the id is re-derived at
 * load (keccak256 of the params), so a typo can never point a user at the wrong market.
 *
 * Units: USDC 6 decimals, stocks 8 decimals. Morpho oracle price() is scaled so that
 * collateral (raw) × price / 1e36 = value in USDC (raw).
 */
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { USDC_BASE } from "@/lib/constants";

export const MORPHO = getAddress("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb");
const IRM = getAddress("0x46415998764c29ab2a25cbea6254146d50d22687");
const WAD = 10n ** 18n;
export const ORACLE_SCALE = 10n ** 36n;

export type MarketParams = { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
export type BorrowMarket = { id: Hex; symbol: string; params: MarketParams };

const RAW: [string, Hex, string, string, bigint][] = [
  ["NVDAc", "0xb4b42dd66cef25614b94510a910d54b2c148e7621d22b4271566724beda63d13", "0xb20000000000000000000078ee7ce2fe4908108c", "0x4f698c04d01d9cebcdd9494c189abdd6c5453f84", 625n * 10n ** 15n],
  ["GOOGLc", "0xa3913d896b7e9c0e0a84f1be27d376cf2065616101cb7c44674af8a154e684cc", "0xb2000000000000000000002d0ba3164cc74f58b7", "0x24dc11055aa5b2c5692e4b77d7285c4f0fd9cf99", 77n * 10n ** 16n],
  ["AAPLc", "0xae1a30486234bf7e7ac166c7c03d9bc5f2cd8a39be2c48e73c665ac7148c3c28", "0xb200000000000000000000c2e324d24d7eecd1fb", "0xecc5c9bf18cb2cfc94c2f7eff8bdd5837a60ab0e", 625n * 10n ** 15n],
  ["METAc", "0x44b343b5087c0bd34207cb5c199f12030777bf6b8c0a128438246f1212f37ca5", "0xb2000000000000000000008bc8786b856e61707c", "0x4752b27dfc1931eb9a5dfefc7fbc9d0af9020dc7", 625n * 10n ** 15n],
  ["SPCXc", "0xce983b9ee6344e16ebbcc66812f23caafc63ae83fcc14fa29b66c7e69e9cecf6", "0xb2000000000000000000007b9fcbd005511acbd5", "0x9079857a2b5fffc3d87052b11b866a185b4a6483", 625n * 10n ** 15n],
];

const paramsAbi = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "uint256" },
] as const;
export const marketId = (p: MarketParams) => keccak256(encodeAbiParameters(paramsAbi, [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv]));

export const BORROW_MARKETS: BorrowMarket[] = RAW.map(([symbol, id, coll, oracle, lltv]) => {
  const params: MarketParams = { loanToken: getAddress(USDC_BASE), collateralToken: getAddress(coll), oracle: getAddress(oracle), irm: IRM, lltv };
  if (marketId(params) !== id) throw new Error(`Morpho market id mismatch for ${symbol}`);
  return { id, symbol, params };
});
export const borrowMarket = (symbol: string) => BORROW_MARKETS.find((m) => m.symbol === symbol);

const marketParamsTuple = {
  type: "tuple",
  name: "marketParams",
  components: [
    { type: "address", name: "loanToken" },
    { type: "address", name: "collateralToken" },
    { type: "address", name: "oracle" },
    { type: "address", name: "irm" },
    { type: "uint256", name: "lltv" },
  ],
} as const;
const marketTuple = {
  type: "tuple",
  name: "market",
  components: [
    { type: "uint128", name: "totalSupplyAssets" },
    { type: "uint128", name: "totalSupplyShares" },
    { type: "uint128", name: "totalBorrowAssets" },
    { type: "uint128", name: "totalBorrowShares" },
    { type: "uint128", name: "lastUpdate" },
    { type: "uint128", name: "fee" },
  ],
} as const;

export const morphoAbi = [
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "id" }],
    outputs: marketTuple.components,
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [
      { type: "bytes32", name: "id" },
      { type: "address", name: "user" },
    ],
    outputs: [
      { type: "uint256", name: "supplyShares" },
      { type: "uint128", name: "borrowShares" },
      { type: "uint128", name: "collateral" },
    ],
  },
  {
    type: "function",
    name: "supplyCollateral",
    stateMutability: "nonpayable",
    inputs: [marketParamsTuple, { type: "uint256", name: "assets" }, { type: "address", name: "onBehalf" }, { type: "bytes", name: "data" }],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      marketParamsTuple,
      { type: "uint256", name: "assets" },
      { type: "uint256", name: "shares" },
      { type: "address", name: "onBehalf" },
      { type: "address", name: "receiver" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      marketParamsTuple,
      { type: "uint256", name: "assets" },
      { type: "uint256", name: "shares" },
      { type: "address", name: "onBehalf" },
      { type: "bytes", name: "data" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [marketParamsTuple, { type: "uint256", name: "assets" }, { type: "address", name: "onBehalf" }, { type: "address", name: "receiver" }],
    outputs: [],
  },
] as const;

export const oracleAbi = [{ type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
export const irmAbi = [
  {
    type: "function",
    name: "borrowRateView",
    stateMutability: "view",
    inputs: [marketParamsTuple, marketTuple],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type MarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

/** Morpho SharesMathLib (virtual shares 1e6, virtual assets 1). */
const VS = 10n ** 6n;
export const toAssetsUp = (shares: bigint, m: MarketState) =>
  (shares * (m.totalBorrowAssets + 1n) + (m.totalBorrowShares + VS) - 1n) / (m.totalBorrowShares + VS);

/** Collateral value in raw USDC. */
export const collateralValue = (collateral: bigint, price: bigint) => (collateral * price) / ORACLE_SCALE;
/** Max debt before liquidation, raw USDC. */
export const maxDebt = (collateral: bigint, price: bigint, lltv: bigint) => (collateralValue(collateral, price) * lltv) / WAD;
/** Health factor: >1 is safe, ≤1 can be liquidated. */
export const health = (collateral: bigint, price: bigint, lltv: bigint, debt: bigint) =>
  debt === 0n ? Infinity : Number(maxDebt(collateral, price, lltv)) / Number(debt);
/** Stock price (USD) at which the position gets liquidated. */
export const liquidationPrice = (collateralRaw: bigint, debtRaw: bigint, lltv: bigint, stockDecimals = 8) =>
  collateralRaw === 0n ? 0 : (Number(debtRaw) / 1e6) / ((Number(collateralRaw) / 10 ** stockDecimals) * (Number(lltv) / 1e18));
/** Per-second borrow rate (WAD) to APY. */
export const rateToApy = (ratePerSecond: bigint) => Math.expm1((Number(ratePerSecond) / 1e18) * 31_536_000);

/** We never let users borrow past this share of the liquidation limit (LLTV). */
export const SAFE_LTV_SHARE = 0.8;
