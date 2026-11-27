/**
 * Server-side loan plans for agents (Bankr, "Borrow from X").
 *
 * Builds the exact Aave V4 calls for one wallet, ready to submit as raw txs: { to, data, value, chainId }.
 * Every call carries the Stock Port Builder Code. Nothing is signed or sent here; the wallet's own agent submits.
 *
 * Rules are the same as the /borrow page:
 * - only the Coinbase Stocks Spoke and its listed reserves, positions always on the wallet's own address
 * - approvals are exact, to the Spoke only
 * - a borrow that would leave health under MIN_HEALTH is refused
 */
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { withBuilderCode } from "@/lib/attribution";
import { USDC_BASE } from "@/lib/constants";
import { AAVE_ORACLE, AAVE_SPOKE, MIN_HEALTH, RAY, STOCK_RESERVES, USDC_RESERVE, VALUE_SCALE, aaveOracleAbi, spokeAbi, stockReserve } from "@/lib/aave";

export type LoanAction = "borrow" | "topup" | "repay" | "status";
export type AgentTx = { to: Address; data: Hex; value: "0"; chainId: 8453; description: string };
export type LoanPlan = {
  ok: boolean;
  summary: string;
  wallet: Address;
  healthNow: number | null;
  healthAfter: number | null;
  debtUsd: number;
  collateralUsd: number;
  transactions: AgentTx[];
};

const REPAY_BUFFER_BPS = 5n;
const REPAY_BUFFER_MIN = 10_000n;
const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export class PlanError extends Error {}

export async function buildLoanPlan(p: {
  wallet: Address;
  action: LoanAction;
  stock?: string;
  /** Stock to deposit, in whole units (e.g. "0.05"). */
  deposit?: string;
  /** USDC to borrow or repay, in dollars (e.g. "10"), or "all" for repay. */
  usdc?: string;
}): Promise<LoanPlan> {
  const { wallet, action } = p;
  const [acct, debtRaw] = await Promise.all([
    publicClient.readContract({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserAccountData", args: [wallet] }),
    publicClient.readContract({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserTotalDebt", args: [USDC_RESERVE.reserveId, wallet] }),
  ]);
  const collateralUsd = Number(acct[3]) / VALUE_SCALE;
  const avgCf = Number(acct[1]) / 1e18;
  const debtUsd = Number(acct[4]) / RAY / VALUE_SCALE;
  const healthNow = debtUsd > 0 ? Number(acct[2]) / 1e18 : Infinity;
  const base = { wallet, debtUsd: round(debtUsd) ?? 0, collateralUsd: round(collateralUsd) ?? 0, healthNow: round(healthNow) };

  if (action === "status") {
    return {
      ok: true,
      ...base,
      healthAfter: base.healthNow,
      transactions: [],
      summary: debtUsd > 0
        ? `Loan: $${debtUsd.toFixed(2)} USDC owed against $${collateralUsd.toFixed(2)} of stock. Health ${healthNow.toFixed(2)} (liquidation at 1.00).`
        : collateralUsd > 0
          ? `No loan. $${collateralUsd.toFixed(2)} of stock deposited.`
          : "No Stock Port loan on this wallet yet.",
    };
  }

  const txs: AgentTx[] = [];
  const push = (to: Address, data: Hex, description: string) => txs.push({ to, data: withBuilderCode(data), value: "0", chainId: 8453, description });

  if (action === "repay") {
    if (debtRaw === 0n) throw new PlanError("This wallet has no USDC loan to repay.");
    const all = !p.usdc || p.usdc.trim().toLowerCase() === "all";
    let amt = all ? debtRaw + (debtRaw * REPAY_BUFFER_BPS) / 10_000n + REPAY_BUFFER_MIN : parseUnits(p.usdc!.trim(), 6);
    if (amt <= 0n) throw new PlanError("Repay amount must be more than 0.");
    if (!all && amt > debtRaw) amt = debtRaw + (debtRaw * REPAY_BUFFER_BPS) / 10_000n + REPAY_BUFFER_MIN;
    const bal = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [wallet] });
    if (bal < amt) throw new PlanError(`Not enough USDC in this wallet: needs $${formatUnits(amt, 6)}, has $${formatUnits(bal, 6)}.`);
    push(USDC_BASE, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AAVE_SPOKE, amt] }), `Approve exactly ${formatUnits(amt, 6)} USDC to Aave`);
    push(AAVE_SPOKE, encodeFunctionData({ abi: spokeAbi, functionName: "repay", args: [USDC_RESERVE.reserveId, amt, wallet] }), `Repay ${formatUnits(amt, 6)} USDC`);
    const debtAfter = Math.max(0, debtUsd - Number(amt) / 1e6);
    const hAfter = debtAfter > 0 ? (collateralUsd * avgCf) / debtAfter : Infinity;
    return { ok: true, ...base, healthAfter: round(hAfter), transactions: txs, summary: `Repay $${formatUnits(amt, 6)} USDC. Loan after: $${debtAfter.toFixed(2)}.` };
  }

  // borrow / topup
  const reserve = p.stock ? stockReserve(p.stock) : undefined;
  if (p.stock && !reserve) throw new PlanError(`${p.stock} can't be used as collateral. Use one of: ${STOCK_RESERVES.map((r) => r.symbol).join(", ")}.`);
  const deposit = p.deposit && reserve ? parseUnits(p.deposit.trim(), 8) : 0n;
  const borrow = action === "borrow" && p.usdc ? parseUnits(p.usdc.trim(), 6) : 0n;
  if (action === "topup" && deposit === 0n) throw new PlanError("Say which stock and how much to add, e.g. stock=NVDAc deposit=0.05.");
  if (action === "borrow" && borrow === 0n) throw new PlanError("Say how much USDC to borrow, e.g. usdc=10.");

  let addWeighted = 0;
  if (reserve) {
    const [price, wal, status, supplied] = await Promise.all([
      publicClient.readContract({ address: AAVE_ORACLE, abi: aaveOracleAbi, functionName: "getReservePrice", args: [reserve.reserveId] }),
      publicClient.readContract({ address: reserve.token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      publicClient.readContract({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserReserveStatus", args: [reserve.reserveId, wallet] }),
      publicClient.readContract({ address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserSuppliedAssets", args: [reserve.reserveId, wallet] }),
    ]);
    if (deposit > wal) throw new PlanError(`This wallet holds ${formatUnits(wal, 8)} ${reserve.symbol}, less than ${formatUnits(deposit, 8)}.`);
    const px = Number(price) / 1e8;
    const idle = status[0] ? 0n : supplied;
    addWeighted = (Number(deposit + idle) / 1e8) * px * reserve.collateralFactor;
    if (deposit > 0n) {
      push(reserve.token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AAVE_SPOKE, deposit] }), `Approve exactly ${formatUnits(deposit, 8)} ${reserve.symbol} to Aave`);
      push(AAVE_SPOKE, encodeFunctionData({ abi: spokeAbi, functionName: "supply", args: [reserve.reserveId, deposit, wallet] }), `Deposit ${formatUnits(deposit, 8)} ${reserve.symbol}`);
    }
    if (!status[0] && deposit + supplied > 0n) {
      push(AAVE_SPOKE, encodeFunctionData({ abi: spokeAbi, functionName: "setUsingAsCollateral", args: [reserve.reserveId, true, wallet] }), `Use ${reserve.symbol} as collateral`);
    }
  }
  const debtAfter = debtUsd + Number(borrow) / 1e6;
  const hAfter = debtAfter > 0 ? (collateralUsd * avgCf + addWeighted) / debtAfter : Infinity;
  if (borrow > 0n) {
    if (hAfter < MIN_HEALTH) {
      const max = Math.max(0, (collateralUsd * avgCf + addWeighted) / MIN_HEALTH - debtUsd);
      throw new PlanError(`That would leave health at ${hAfter.toFixed(2)}, under ${MIN_HEALTH}. Most you can borrow now: $${max.toFixed(2)}.`);
    }
    push(AAVE_SPOKE, encodeFunctionData({ abi: spokeAbi, functionName: "borrow", args: [USDC_RESERVE.reserveId, borrow, wallet] }), `Borrow ${formatUnits(borrow, 6)} USDC to this wallet`);
  }
  if (!txs.length) throw new PlanError("Nothing to do.");
  return {
    ok: true,
    ...base,
    healthAfter: round(hAfter),
    transactions: txs,
    summary: `${txs.map((t) => t.description).join(", then ")}. Health after: ${Number.isFinite(hAfter) ? hAfter.toFixed(2) : "no loan"}.`,
  };
}
