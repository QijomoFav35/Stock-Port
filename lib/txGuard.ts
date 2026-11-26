/**
 * Client-side safety check on every call before it reaches the wallet.
 *
 * The quote API builds the calls, but the browser does not trust it blindly. If the server, a
 * swap provider or a proxy in between ever returned something unexpected, the wallet prompt
 * would never open. Checks:
 *  - USDC (or a dust token) is only ever approved to a known contract, for the exact amount
 *    being spent, never "unlimited".
 *  - Aerodrome and 0x calls may only go to their official contracts.
 *  - Aerodrome buys must send the stock to the connected wallet.
 *  - No call may move tokens or hand out approvals on its own (transfer, transferFrom,
 *    approve, increaseAllowance, setApprovalForAll, permit).
 */
import { decodeFunctionData, getAddress, isAddressEqual, toFunctionSelector, type Address, type Hex } from "viem";
import { slipstreamRouterAbi } from "@/lib/aerodrome";
import { AGGREGATORS_ON, USDC_BASE } from "@/lib/constants";

/** Official contracts on Base mainnet. Each links to its verified source on Basescan. */
export const KNOWN_CONTRACTS = {
  aerodromeRouter: {
    address: getAddress("0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F"),
    name: "Aerodrome Slipstream swap router",
  },
  zeroExAllowanceHolder: {
    address: getAddress("0x0000000000001fF3684f28c67538d4D072C22734"),
    name: "AllowanceHolder swap contract (used by o1 and 0x)",
  },
  permit2: {
    address: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    name: "Uniswap Permit2",
  },
  usdc: { address: getAddress(USDC_BASE), name: "USDC (Circle)" },
} as const;

export function contractName(addr: Address): string | undefined {
  return Object.values(KNOWN_CONTRACTS).find((c) => isAddressEqual(c.address, addr))?.name;
}

export const basescanAddress = (a: Address) => `https://basescan.org/address/${a}`;
export const basescanTx = (h: string) => `https://basescan.org/tx/${h}`;

const FORBIDDEN_SELECTORS = new Set(
  [
    "transfer(address,uint256)",
    "transferFrom(address,address,uint256)",
    "approve(address,uint256)",
    "increaseAllowance(address,uint256)",
    "setApprovalForAll(address,bool)",
    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  ].map((s) => toFunctionSelector(s)),
);

export class UnsafeTransactionError extends Error {
  constructor(reason: string) {
    super(`Stopped for your safety: ${reason}. Nothing was sent to your wallet.`);
  }
}

type Provider = "aerodrome" | "o1" | "0x";
type Call = { to: Address; data: Hex; value: Hex | string };

/** Approval must go to a known spender for this route and never exceed what is being spent. */
export function checkApproval(
  provider: Provider,
  approval: { token: Address; spender: Address; amount: string } | undefined,
  maxAmount: bigint,
  expectedToken: Address = USDC_BASE,
) {
  if (provider !== "aerodrome" && !AGGREGATORS_ON) throw new UnsafeTransactionError(`the ${provider} route is off`);
  if (!approval) return;
  if (!isAddressEqual(approval.token, expectedToken)) throw new UnsafeTransactionError("approval for an unexpected token");
  const allowed: Record<Provider, Address> = {
    aerodrome: KNOWN_CONTRACTS.aerodromeRouter.address,
    "0x": KNOWN_CONTRACTS.zeroExAllowanceHolder.address,
    o1: KNOWN_CONTRACTS.zeroExAllowanceHolder.address,
  };
  const ok =
    isAddressEqual(approval.spender, allowed[provider]) ||
    (provider === "o1" && isAddressEqual(approval.spender, KNOWN_CONTRACTS.permit2.address));
  if (!ok) {
    throw new UnsafeTransactionError("approval to an unknown contract");
  }
  if (BigInt(approval.amount) > maxAmount) throw new UnsafeTransactionError("approval larger than the amount you are spending");
}

/** Each swap call must target the route's official contract and pay out to the user. */
export function checkSwapCall(provider: Provider, call: Call, account: Address) {
  if (provider !== "aerodrome" && !AGGREGATORS_ON) throw new UnsafeTransactionError(`the ${provider} route is off`);
  if (BigInt(call.value || "0") !== 0n) throw new UnsafeTransactionError("a swap asked for ETH");
  const selector = call.data.slice(0, 10).toLowerCase() as Hex;
  if (FORBIDDEN_SELECTORS.has(selector)) throw new UnsafeTransactionError("a call tried to move or approve tokens directly");

  if (provider === "aerodrome") {
    if (!isAddressEqual(call.to, KNOWN_CONTRACTS.aerodromeRouter.address)) {
      throw new UnsafeTransactionError("a swap pointed at an unknown contract");
    }
    const { functionName, args } = decodeFunctionData({ abi: slipstreamRouterAbi, data: call.data });
    if (functionName !== "exactInputSingle") throw new UnsafeTransactionError("unexpected router function");
    const p = args[0];
    if (!isAddressEqual(p.recipient, account)) throw new UnsafeTransactionError("the stock would be sent to another address");
    if (!isAddressEqual(p.tokenIn, USDC_BASE)) throw new UnsafeTransactionError("the swap would spend a token other than USDC");
    if (p.amountOutMinimum === 0n) throw new UnsafeTransactionError("the swap had no price protection");
  } else if (provider === "0x") {
    if (!isAddressEqual(call.to, KNOWN_CONTRACTS.zeroExAllowanceHolder.address)) {
      throw new UnsafeTransactionError("a swap pointed at an unknown contract");
    }
  } else {
    // o1 builds its swaps on the AllowanceHolder contract (seen in live o1 orders, Nov 2026).
    if (!isAddressEqual(call.to, KNOWN_CONTRACTS.zeroExAllowanceHolder.address)) {
      throw new UnsafeTransactionError("an o1 swap pointed at an unknown contract");
    }
  }
}

/** Coinbase tokenized stocks (B20 assets) all live at 0xb2000000000000000000…. */
export const isTokenizedStock = (a: Address) => /^0xb20{19}/i.test(a);

/** Rotate: a stock approval must be for a stock being sold, to that route's contract, for at most the amount sold. */
export function checkSellApproval(
  provider: "aerodrome" | "o1",
  approval: { token: Address; spender: Address; amount: string },
  legs: { token: Address; amountIn: string }[],
) {
  const leg = legs.find((l) => isAddressEqual(l.token, approval.token));
  if (!leg || !isTokenizedStock(approval.token)) throw new UnsafeTransactionError("approval for a token you are not selling");
  const spender = provider === "aerodrome" ? KNOWN_CONTRACTS.aerodromeRouter.address : KNOWN_CONTRACTS.zeroExAllowanceHolder.address;
  if (!isAddressEqual(approval.spender, spender)) throw new UnsafeTransactionError("approval to an unknown contract");
  if (BigInt(approval.amount) > BigInt(leg.amountIn)) throw new UnsafeTransactionError("approval larger than the amount you are selling");
}

/** Rotate: a sell must go to the route's official contract; Aerodrome sells must pay USDC to the user with a minimum. */
export function checkSellCall(provider: "aerodrome" | "o1", call: Call, account: Address, legs: { token: Address }[]) {
  if (provider !== "aerodrome" && !AGGREGATORS_ON) throw new UnsafeTransactionError(`the ${provider} route is off`);
  if (BigInt(call.value || "0") !== 0n) throw new UnsafeTransactionError("a swap asked for ETH");
  const selector = call.data.slice(0, 10).toLowerCase() as Hex;
  if (FORBIDDEN_SELECTORS.has(selector)) throw new UnsafeTransactionError("a call tried to move or approve tokens directly");
  if (provider === "aerodrome") {
    if (!isAddressEqual(call.to, KNOWN_CONTRACTS.aerodromeRouter.address)) throw new UnsafeTransactionError("a swap pointed at an unknown contract");
    const { functionName, args } = decodeFunctionData({ abi: slipstreamRouterAbi, data: call.data });
    if (functionName !== "exactInputSingle") throw new UnsafeTransactionError("unexpected router function");
    const p = args[0];
    if (!legs.some((l) => isAddressEqual(l.token, p.tokenIn))) throw new UnsafeTransactionError("a sell would spend a token you didn't pick");
    if (!isAddressEqual(p.tokenOut, USDC_BASE)) throw new UnsafeTransactionError("a sell would pay out something other than USDC");
    if (!isAddressEqual(p.recipient, account)) throw new UnsafeTransactionError("the USDC would be sent to another address");
    if (p.amountOutMinimum === 0n) throw new UnsafeTransactionError("the swap had no price protection");
  } else if (!isAddressEqual(call.to, KNOWN_CONTRACTS.zeroExAllowanceHolder.address)) {
    throw new UnsafeTransactionError("an o1 swap pointed at an unknown contract");
  }
}
