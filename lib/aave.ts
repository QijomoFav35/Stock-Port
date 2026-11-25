/**
 * Borrow USDC against tokenized stocks on Aave V4 (Base, Equities Hub, "Coinbase Stocks" Spoke).
 *
 * Users call the Spoke: supply(reserveId, amount, onBehalfOf), setUsingAsCollateral(reserveId, true, onBehalfOf),
 * borrow / repay / withdraw(reserveId, amount, onBehalfOf). Approvals go to the Spoke.
 * Function selectors were checked against the Spoke implementation's bytecode and the reads were decoded
 * against a live position on 2026-11-25 (see comments below for units).
 */
import { getAddress, type Address } from "viem";
import { USDC_BASE } from "@/lib/constants";

export const AAVE_SPOKE = getAddress("0x17905Db0e4A3514467539956c084180616AE7B8D");
export const AAVE_ORACLE = getAddress("0xabaf048fd7675ea34a84332371ffd5d55e322a47");
export const AAVE_API = "https://api.v4.aave.com/graphql";

export type AaveReserve = { reserveId: bigint; symbol: string; token: Address; decimals: number; collateralFactor: number };

/** Collateral reserves on the Spoke (reserve id, collateral factor at launch; live values come from the Aave API). */
export const STOCK_RESERVES: AaveReserve[] = (
  [
    [0n, "AAPLc", "0xb200000000000000000000C2e324d24d7eEcd1fb", 0.78],
    [1n, "AMZNc", "0xb200000000000000000000d9192b6B456483C2E8", 0.73],
    [2n, "GOOGLc", "0xb2000000000000000000002D0BA3164cc74f58B7", 0.76],
    [3n, "METAc", "0xb2000000000000000000008bC8786B856E61707C", 0.65],
    [4n, "MSFTc", "0xB200000000000000000000Ab99cFa739E253872B", 0.79],
    [5n, "NVDAc", "0xb20000000000000000000078ee7ce2fE4908108C", 0.7],
    [6n, "TSLAc", "0xb2000000000000000000001e800a7f5189430cD0", 0.65],
    [8n, "SPCXc", "0xb2000000000000000000007b9fcbd005511aCBd5", 0.55],
  ] as const
).map(([reserveId, symbol, token, collateralFactor]) => ({ reserveId, symbol, token: getAddress(token), decimals: 8, collateralFactor }));

export const USDC_RESERVE: AaveReserve = { reserveId: 7n, symbol: "USDC", token: getAddress(USDC_BASE), decimals: 6, collateralFactor: 0 };
export const stockReserve = (symbol: string) => STOCK_RESERVES.find((r) => r.symbol === symbol);
export const reserveById = (id: bigint) => [...STOCK_RESERVES, USDC_RESERVE].find((r) => r.reserveId === id);

export const spokeAbi = [
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "reserveId" }, { type: "uint256", name: "amount" }, { type: "address", name: "onBehalfOf" }], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "reserveId" }, { type: "uint256", name: "amount" }, { type: "address", name: "onBehalfOf" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "reserveId" }, { type: "uint256", name: "amount" }, { type: "address", name: "onBehalfOf" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "reserveId" }, { type: "uint256", name: "amount" }, { type: "address", name: "onBehalfOf" }], outputs: [] },
  {
    type: "function",
    name: "setUsingAsCollateral",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "reserveId" }, { type: "bool", name: "usingAsCollateral" }, { type: "address", name: "onBehalfOf" }],
    outputs: [],
  },
  /**
   * Decoded on a live position: riskPremium, avgCollateralFactor (WAD), healthFactor (WAD),
   * totalCollateralValue (USD × 1e26), totalDebtValueRay (USD × 1e26 × 1e27), activeCollateralCount, borrowCount.
   */
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ type: "address", name: "user" }],
    outputs: [
      { type: "uint256", name: "riskPremium" },
      { type: "uint256", name: "avgCollateralFactor" },
      { type: "uint256", name: "healthFactor" },
      { type: "uint256", name: "totalCollateralValue" },
      { type: "uint256", name: "totalDebtValueRay" },
      { type: "uint256", name: "activeCollateralCount" },
      { type: "uint256", name: "borrowCount" },
    ],
  },
  { type: "function", name: "getUserSuppliedAssets", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getUserTotalDebt", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getUserReserveStatus",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [
      { type: "bool", name: "usingAsCollateral" },
      { type: "bool", name: "borrowing" },
    ],
  },
  { type: "function", name: "getReserveSuppliedAssets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserveTotalDebt", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/** Prices in USD with 8 decimals. */
export const aaveOracleAbi = [
  { type: "function", name: "getReservePrice", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export const VALUE_SCALE = 1e26;
export const RAY = 1e27;

/** We stop new loans that would leave the health factor under this. Aave liquidates below 1.0. */
export const MIN_HEALTH = 1.3;
