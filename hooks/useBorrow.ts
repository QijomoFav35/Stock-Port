"use client";
/**
 * Borrow USDC against a tokenized stock on Morpho, and pay it back.
 *
 * Borrow: [approve stock to Morpho, supplyCollateral, borrow USDC to you].
 * Repay:  [approve USDC to Morpho, repay, withdrawCollateral back to you].
 * One EIP-5792 atomic batch when the wallet supports it, otherwise sequential txs.
 * Every call goes to the Morpho contract with market params checked against lib/morpho.ts,
 * approvals are exact, and we cap new loans at 80% of the liquidation limit.
 */
import { useCallback, useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { DATA_SUFFIX, requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import { sendCallsCapabilities } from "@/lib/paymaster";
import { USDC_BASE } from "@/lib/constants";
import {
  BORROW_MARKETS,
  MORPHO,
  SAFE_LTV_SHARE,
  irmAbi,
  marketId,
  maxDebt,
  morphoAbi,
  oracleAbi,
  rateToApy,
  toAssetsUp,
  type BorrowMarket,
  type MarketParams,
  type MarketState,
} from "@/lib/morpho";

export type BorrowRow = {
  market: BorrowMarket;
  price: bigint; // Morpho oracle price (1e36 scale)
  apy: number;
  liquidity: bigint; // USDC left to borrow in the market, raw
  wallet: bigint; // stock balance in the wallet, raw
  collateral: bigint; // stock deposited, raw
  debt: bigint; // USDC owed, raw (rounded up)
  borrowShares: bigint;
  state: MarketState;
};
export type BorrowStatus = "idle" | "confirming" | "pending" | "success" | "error";
type SendCall = { to: Address; data: Hex; label: string };

/** Interest keeps accruing while you confirm, so a full repay approves the debt plus this much. */
const REPAY_BUFFER_BPS = 5n; // 0.05%
const REPAY_BUFFER_MIN = 10_000n; // $0.01

function assertSafe(c: SendCall, m: BorrowMarket, account: Address) {
  const stop = (why: string): never => {
    throw new Error(`Stopped for your safety: ${why}. Nothing was sent to your wallet.`);
  };
  if (isAddressEqual(c.to, m.params.collateralToken) || isAddressEqual(c.to, USDC_BASE)) {
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
    const spender = (d.args as readonly unknown[] | undefined)?.[0] as Address | undefined;
    if (d.functionName !== "approve" || !spender || !isAddressEqual(spender, MORPHO)) stop("token call other than an approval to Morpho");
    return;
  }
  if (!isAddressEqual(c.to, MORPHO)) stop("call to an unknown contract");
  const d = decodeFunctionData({ abi: morphoAbi, data: c.data });
  if (!["supplyCollateral", "borrow", "repay", "withdrawCollateral"].includes(d.functionName)) stop("unexpected Morpho function");
  const args = d.args as readonly unknown[];
  const p = args[0] as MarketParams;
  if (marketId(p) !== m.id) stop("market mismatch");
  // Every position and every payout must be the connected wallet.
  const who = (args.slice(2) as unknown[]).filter((x): x is Address => typeof x === "string" && x.length === 42);
  if (!who.length || who.some((x) => !isAddressEqual(x, account))) stop("funds or position would go to another address");
}

export function useBorrow(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [rows, setRows] = useState<BorrowRow[]>();
  const [loadError, setLoadError] = useState<string>();
  const [status, setStatus] = useState<BorrowStatus>("idle");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [hashes, setHashes] = useState<Hash[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const who = account ?? "0x0000000000000000000000000000000000000001";
        const first = await publicClient.multicall({
          allowFailure: false,
          contracts: BORROW_MARKETS.flatMap((m) => [
            { address: MORPHO, abi: morphoAbi, functionName: "market", args: [m.id] } as const,
            { address: MORPHO, abi: morphoAbi, functionName: "position", args: [m.id, who] } as const,
            { address: m.params.oracle, abi: oracleAbi, functionName: "price" } as const,
            { address: m.params.collateralToken, abi: erc20Abi, functionName: "balanceOf", args: [who] } as const,
          ]),
        });
        const states = BORROW_MARKETS.map((_, i) => {
          const s = first[i * 4] as unknown as readonly bigint[];
          return { totalSupplyAssets: s[0], totalSupplyShares: s[1], totalBorrowAssets: s[2], totalBorrowShares: s[3], lastUpdate: s[4], fee: s[5] };
        });
        const rates = await publicClient.multicall({
          allowFailure: true,
          contracts: BORROW_MARKETS.map((m, i) => ({ address: m.params.irm, abi: irmAbi, functionName: "borrowRateView", args: [m.params, states[i]] }) as const),
        });
        if (dead) return;
        setRows(
          BORROW_MARKETS.map((m, i) => {
            const pos = first[i * 4 + 1] as unknown as readonly bigint[];
            const state = states[i];
            const r = rates[i];
            return {
              market: m,
              state,
              price: first[i * 4 + 2] as unknown as bigint,
              wallet: account ? (first[i * 4 + 3] as unknown as bigint) : 0n,
              collateral: account ? pos[2] : 0n,
              borrowShares: account ? pos[1] : 0n,
              debt: account ? toAssetsUp(pos[1], state) : 0n,
              liquidity: state.totalSupplyAssets - state.totalBorrowAssets,
              apy: r.status === "success" ? rateToApy(r.result) : NaN,
            };
          }),
        );
        setLoadError(undefined);
      } catch (e) {
        if (!dead) setLoadError(shortError(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [account, tick]);

  const send = useCallback(
    async (m: BorrowMarket, calls: SendCall[], attestNonUS: boolean) => {
      setError(undefined);
      setHashes([]);
      try {
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        if (!attestNonUS) throw new Error("Please confirm you are not a US person");
        const geo = await fetch("/api/geo").then((r) => r.json()).catch(() => ({}));
        if (geo?.tradingBlocked) throw new Error("Borrowing is not available in your region.");
        const suffix = requireDataSuffix();
        for (const c of calls) assertSafe(c, m, account);
        if ((await walletClient.getChainId()) !== base.id) await walletClient.switchChain({ id: base.id });

        const caps = await getBaseCapabilities(walletClient, account);
        const out: Hash[] = [];
        if (caps.atomic && calls.length > 1) {
          setStatus("confirming");
          setStep("Confirm in your wallet");
          const { id } = await walletClient.sendCalls({
            account,
            chain: base,
            forceAtomic: true,
            calls: calls.map((c) => ({ to: c.to, value: 0n, data: caps.dataSuffix ? c.data : withBuilderCode(c.data) })),
            capabilities: sendCallsCapabilities(caps, suffix),
          });
          setStatus("pending");
          setStep("Waiting for Base confirmation");
          const st = await walletClient.waitForCallsStatus({ id, timeout: 120_000 });
          out.push(...new Set((st.receipts ?? []).map((r) => r.transactionHash)));
          if (st.status !== "success") throw new Error(`Transaction reverted (status ${st.statusCode}). Nothing moved.`);
        } else {
          for (const [i, c] of calls.entries()) {
            setStatus("confirming");
            setStep(`${c.label} (${i + 1}/${calls.length}): confirm in wallet`);
            const hash = await walletClient.sendTransaction({ account, chain: base, to: c.to, data: withBuilderCode(c.data) });
            out.push(hash);
            setStatus("pending");
            setStep(`${c.label}: waiting for confirmation`);
            const r = await publicClient.waitForTransactionReceipt({ hash });
            if (r.status !== "success") throw new Error(`${c.label} reverted (${hash}).`);
          }
        }
        setHashes(out);
        setStatus("success");
        setStep(undefined);
        refresh();
        return out;
      } catch (e) {
        setStatus(isUserRejection(e) ? "idle" : "error");
        setStep(undefined);
        if (!isUserRejection(e)) setError(shortError(e));
      }
    },
    [walletClient, account, refresh],
  );

  /** Deposit `deposit` (raw stock) and borrow `amount` (raw USDC). Either can be 0. */
  const borrow = useCallback(
    async (row: BorrowRow, deposit: bigint, amount: bigint, attestNonUS: boolean) => {
      if (!account) return;
      const m = row.market;
      const newColl = row.collateral + deposit;
      const limit = (maxDebt(newColl, row.price, m.params.lltv) * BigInt(Math.round(SAFE_LTV_SHARE * 1000))) / 1000n;
      if (deposit > row.wallet) return setError(`You only hold ${row.wallet} raw ${m.symbol}.`);
      if (row.debt + amount > limit) return setError("That's past the safe limit for this collateral. Borrow less or add more stock.");
      if (amount > row.liquidity) return setError("Not enough USDC left in this Morpho market right now. Try a smaller amount.");
      const calls: SendCall[] = [];
      if (deposit > 0n) {
        const allowance = await publicClient.readContract({ address: m.params.collateralToken, abi: erc20Abi, functionName: "allowance", args: [account, MORPHO] });
        if (allowance < deposit) {
          calls.push({ to: m.params.collateralToken, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO, deposit] }), label: `Approve ${m.symbol}` });
        }
        calls.push({
          to: MORPHO,
          data: encodeFunctionData({ abi: morphoAbi, functionName: "supplyCollateral", args: [m.params, deposit, account, "0x"] }),
          label: `Deposit ${m.symbol}`,
        });
      }
      if (amount > 0n) {
        calls.push({
          to: MORPHO,
          data: encodeFunctionData({ abi: morphoAbi, functionName: "borrow", args: [m.params, amount, 0n, account, account] }),
          label: "Borrow USDC",
        });
      }
      if (!calls.length) return;
      return send(m, calls, attestNonUS);
    },
    [account, send],
  );

  /** Repay `amount` (raw USDC), or everything when amount is "all"; optionally withdraw all stock after a full repay. */
  const repay = useCallback(
    async (row: BorrowRow, amount: bigint | "all", withdraw: boolean, attestNonUS: boolean) => {
      if (!account) return;
      const m = row.market;
      const full = amount === "all" || amount >= row.debt;
      const approveAmt = full ? row.debt + (row.debt * REPAY_BUFFER_BPS) / 10_000n + REPAY_BUFFER_MIN : (amount as bigint);
      const usdc = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account] });
      if (row.debt > 0n && usdc < (full ? row.debt : (amount as bigint))) return setError("Not enough USDC in your wallet to repay that.");
      const calls: SendCall[] = [];
      if (row.debt > 0n) {
        const allowance = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "allowance", args: [account, MORPHO] });
        if (allowance < approveAmt) {
          calls.push({ to: USDC_BASE, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO, approveAmt] }), label: "Approve USDC" });
        }
        calls.push({
          to: MORPHO,
          data: encodeFunctionData({
            abi: morphoAbi,
            functionName: "repay",
            args: full ? [m.params, 0n, row.borrowShares, account, "0x"] : [m.params, amount as bigint, 0n, account, "0x"],
          }),
          label: "Repay USDC",
        });
      }
      if (withdraw && full && row.collateral > 0n) {
        calls.push({
          to: MORPHO,
          data: encodeFunctionData({ abi: morphoAbi, functionName: "withdrawCollateral", args: [m.params, row.collateral, account, account] }),
          label: `Withdraw ${m.symbol}`,
        });
      }
      if (!calls.length) return;
      return send(m, calls, attestNonUS);
    },
    [account, send],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setHashes([]);
  }, []);

  return { rows, loadError, borrow, repay, status, step, error, hashes, reset, refresh, builderCodeConfigured: !!DATA_SUFFIX };
}
