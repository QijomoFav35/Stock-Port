/**
 * Server-side rule for gas sponsorship: only pay gas for smart wallet calls into Stock Port's own routes.
 * The CDP dashboard allowlist is the second line. This one runs before the request ever reaches CDP.
 *
 * A Base Account userOp calls execute(target, value, data) or executeBatch([(target, value, data)]) on the
 * user's wallet. Every target must be a known contract, no call may send ETH, and token calls may only
 * approve a known spender (no transfers to anyone else).
 */
import { decodeFunctionData, getAddress, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
import { KNOWN_CONTRACTS } from "@/lib/txGuard";
import { AAVE_SPOKE } from "@/lib/aave";
import { LOAN_GUARD } from "@/lib/loanGuard";
import { AUTOPILOT } from "@/lib/autopilotContract";
import { UNIVERSE } from "@/lib/baskets";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";

const walletAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const APPROVE = toFunctionSelector("approve(address,uint256)");
const TOKEN_MOVES = new Set(
  ["transfer(address,uint256)", "transferFrom(address,address,uint256)", "increaseAllowance(address,uint256)", "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"].map((s) =>
    toFunctionSelector(s),
  ),
);

let stockCache: { at: number; set: Set<string> } | undefined;
async function stockTokens(): Promise<Set<string>> {
  if (stockCache && Date.now() - stockCache.at < 3600_000) return stockCache.set;
  const all = await listTokenizedStocks();
  const set = new Set(all.filter((t) => (UNIVERSE as readonly string[]).includes(t.symbol)).map((t) => t.contract_address.toLowerCase()));
  stockCache = { at: Date.now(), set };
  return set;
}

/** Contracts that may be called directly or approved as a spender. */
function spenders(): Set<string> {
  return new Set(
    [KNOWN_CONTRACTS.aerodromeRouter.address, KNOWN_CONTRACTS.zeroExAllowanceHolder.address, KNOWN_CONTRACTS.permit2.address, AAVE_SPOKE, ...(LOAN_GUARD ? [LOAN_GUARD] : []), ...(AUTOPILOT ? [AUTOPILOT] : [])].map(
      (a) => a.toLowerCase(),
    ),
  );
}

/** Returns a reason string when the userOp must not be sponsored, or undefined when it's fine. */
export async function sponsorRefusal(userOp: unknown): Promise<string | undefined> {
  const callData = (userOp as { callData?: unknown })?.callData;
  if (typeof callData !== "string" || !callData.startsWith("0x")) return "no callData";
  let calls: { target: Address; value: bigint; data: Hex }[];
  try {
    const d = decodeFunctionData({ abi: walletAbi, data: callData as Hex });
    calls =
      d.functionName === "execute"
        ? [{ target: d.args[0], value: d.args[1], data: d.args[2] }]
        : d.args[0].map((c) => ({ target: c.target, value: c.value, data: c.data }));
  } catch {
    return "unknown wallet call";
  }
  if (!calls.length) return "empty batch";
  const tokens = await stockTokens();
  const usdc = KNOWN_CONTRACTS.usdc.address.toLowerCase();
  const ok = spenders();
  for (const c of calls) {
    const to = getAddress(c.target).toLowerCase();
    if (c.value !== 0n) return "sends ETH";
    const sel = c.data.slice(0, 10).toLowerCase();
    if (TOKEN_MOVES.has(sel as Hex)) return "token transfer";
    // Approvals are fine on any token (Dust Sweep approves dust tokens) as long as the spender is ours.
    if (sel === APPROVE) {
      const spender = `0x${c.data.slice(34, 74)}`.toLowerCase();
      if (!ok.has(spender)) return "approval to unknown spender";
      continue;
    }
    if (to === usdc || tokens.has(to)) return "unexpected token call";
    if (!ok.has(to)) return "unknown contract";
  }
  return undefined;
}
