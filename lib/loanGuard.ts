/**
 * LoanGuard (contracts/LoanGuard.sol): repay-only liquidation shield for Aave V4 stock loans.
 * Set NEXT_PUBLIC_LOAN_GUARD_ADDRESS after deploying. Health factors use 1e18 = 1.00.
 */
import { getAddress, isAddress, type Address } from "viem";

const raw = process.env.NEXT_PUBLIC_LOAN_GUARD_ADDRESS ?? "";
export const LOAN_GUARD: Address | undefined = isAddress(raw) ? getAddress(raw) : undefined;
/** Local preview: NEXT_PUBLIC_GUARD_PREVIEW=1 shows the guard UI with sample data and sends nothing. Never set it on Render. */
export const GUARD_PREVIEW = process.env.NEXT_PUBLIC_GUARD_PREVIEW === "1" && !LOAN_GUARD;
export const GIVER = getAddress("0x9E81c2fDE4E34CAB3AB1667ca3c932dBAED95F08");
/** Block the guard was deployed in, so the keeper and Agent log only scan from there. */
export const LOAN_GUARD_FROM_BLOCK = BigInt(process.env.NEXT_PUBLIC_LOAN_GUARD_FROM_BLOCK || "0");

export const loanGuardAbi = [
  { type: "function", name: "configure", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "trigger" }, { type: "uint256", name: "target" }, { type: "uint256", name: "weekendTrigger" }], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "amount" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "amount" }], outputs: [] },
  { type: "function", name: "protect", stateMutability: "nonpayable", inputs: [{ type: "address", name: "user" }], outputs: [{ type: "uint256", name: "repaid" }] },
  {
    type: "function",
    name: "guards",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "uint128", name: "reserve" },
      { type: "uint64", name: "trigger" },
      { type: "uint64", name: "target" },
      { type: "uint64", name: "weekendTrigger" },
      { type: "uint64", name: "lastProtect" },
    ],
  },
  {
    type: "function",
    name: "check",
    stateMutability: "view",
    inputs: [{ type: "address", name: "user" }],
    outputs: [
      { type: "bool", name: "needed" },
      { type: "uint256", name: "health" },
      { type: "uint256", name: "trigger" },
      { type: "uint256", name: "amount" },
    ],
  },
  { type: "function", name: "userCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "users", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "totalRepaid", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protectCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "Configured",
    inputs: [
      { type: "address", name: "user", indexed: true },
      { type: "uint256", name: "trigger", indexed: false },
      { type: "uint256", name: "target", indexed: false },
      { type: "uint256", name: "weekendTrigger", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Protected",
    inputs: [
      { type: "address", name: "user", indexed: true },
      { type: "address", name: "caller", indexed: true },
      { type: "uint256", name: "repaid", indexed: false },
      { type: "uint256", name: "healthBefore", indexed: false },
      { type: "uint256", name: "healthAfter", indexed: false },
      { type: "bool", name: "weekend", indexed: false },
    ],
  },
] as const;

export const positionManagerAbi = [
  { type: "function", name: "setUserPositionManager", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "isPositionManager", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;

export const hf = (x: number) => BigInt(Math.round(x * 1e4)) * 10n ** 14n;
