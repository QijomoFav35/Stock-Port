"use client";
/**
 * Borrow USDC against tokenized stocks on Aave V4 (Base), and pay it back.
 *
 * Borrow: [approve stock to the Spoke, supply, use as collateral (first time), borrow USDC to you].
 * Repay:  [approve USDC to the Spoke, repay, withdraw the stock back to you].
 * Buy and borrow: [approve USDC to Aerodrome, buy each stock to you, approve + supply each stock's guaranteed
 *   minimum to the Spoke, use as collateral, borrow USDC]. Anything above the minimum stays in your wallet.
 * One EIP-5792 atomic batch when the wallet supports it, otherwise sequential txs.
 * Every call is checked before the wallet opens: only the Aave Spoke or an exact approval to it,
 * only known reserves, and every position is the connected wallet's own.
 */
import { useCallback, useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, isAddressEqual, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { DATA_SUFFIX, requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import { sendCallsCapabilities } from "@/lib/paymaster";
import { USDC_BASE } from "@/lib/constants";
import { checkApproval, checkSwapCall } from "@/lib/txGuard";
import { slipstreamRouterAbi } from "@/lib/aerodrome";
import type { PortQuote } from "@/lib/basketQuote";
import {
  AAVE_ORACLE,
  AAVE_SPOKE,
  MIN_HEALTH,
  RAY,
  STOCK_RESERVES,
  USDC_RESERVE,
  VALUE_SCALE,
  aaveOracleAbi,
  reserveById,
  spokeAbi,
  type AaveReserve,
} from "@/lib/aave";

export type StockRow = {
  reserve: AaveReserve;
  price: number; // USD
  wallet: bigint; // stock in the wallet, raw (8 decimals)
  supplied: bigint; // stock deposited on Aave, raw
  usingAsCollateral: boolean;
};
export type Account = {
  collateralUsd: number;
  avgCollateralFactor: number;
  debtUsd: number;
  debtRaw: bigint; // USDC owed, raw (6 decimals)
  health: number; // Infinity with no debt
};
export type Market = { usdcAvailable: number; borrowApy?: number; factors: Record<string, number> };
export type BorrowStatus = "idle" | "confirming" | "pending" | "success" | "error";
/** `checked`: a swap call already validated by lib/txGuard.ts (checkApproval / checkSwapCall). */
type SendCall = { to: Address; data: Hex; label: string; checked?: true };

const NOBODY = "0x0000000000000000000000000000000000000001" as Address;
/** Interest accrues while you confirm, so a full repay sends the debt plus a little. If Aave doesn't cap it, the batch reverts and nothing moves. */
const REPAY_BUFFER_BPS = 5n; // 0.05%
const REPAY_BUFFER_MIN = 10_000n; // $0.01

function assertSafe(c: SendCall, account: Address) {
  const stop = (why: string): never => {
    throw new Error(`Stopped for your safety: ${why}. Nothing was sent to your wallet.`);
  };
  const isToken = isAddressEqual(c.to, USDC_BASE) || STOCK_RESERVES.some((r) => isAddressEqual(r.token, c.to));
  if (isToken) {
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
    const spender = (d.args as readonly unknown[] | undefined)?.[0] as Address | undefined;
    if (d.functionName !== "approve" || !spender || !isAddressEqual(spender, AAVE_SPOKE)) stop("token call other than an approval to Aave");
    return;
  }
  if (!isAddressEqual(c.to, AAVE_SPOKE)) stop("call to an unknown contract");
  const d = decodeFunctionData({ abi: spokeAbi, data: c.data });
  if (!["supply", "borrow", "repay", "withdraw", "setUsingAsCollateral"].includes(d.functionName)) stop("unexpected Aave function");
  const args = d.args as readonly unknown[];
  if (!reserveById(args[0] as bigint)) stop("unknown Aave reserve");
  if (!isAddressEqual(args[2] as Address, account)) stop("the position would belong to another address");
}

/** Health factor after adding `addCollUsd` of collateral at factor `cf` and `addDebtUsd` of debt. */
export function healthAfter(a: Account, addCollUsd: number, cf: number, addDebtUsd: number) {
  const weighted = a.collateralUsd * a.avgCollateralFactor + addCollUsd * cf;
  const debt = a.debtUsd + addDebtUsd;
  return debt <= 0 ? Infinity : weighted / debt;
}

/** Most USDC you can borrow while keeping health at or above MIN_HEALTH. */
export function safeBorrowUsd(a: Account, addCollUsd: number, cf: number) {
  const weighted = a.collateralUsd * a.avgCollateralFactor + addCollUsd * cf;
  return Math.max(0, weighted / MIN_HEALTH - a.debtUsd);
}

/** Price of this stock at which the account hits health 1.0, other collateral unchanged. 0 = no risk. */
export function liquidationPrice(a: Account, row: StockRow, addQty: number, addDebtUsd: number, cf: number) {
  const qty = Number(row.supplied) / 1e8 + addQty;
  if (qty <= 0) return 0;
  const thisWeighted = row.usingAsCollateral ? (Number(row.supplied) / 1e8) * row.price * cf : 0;
  const otherWeighted = a.collateralUsd * a.avgCollateralFactor - thisWeighted;
  const need = a.debtUsd + addDebtUsd - otherWeighted;
  return need <= 0 ? 0 : need / (qty * cf);
}

export function useBorrow(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [rows, setRows] = useState<StockRow[]>();
  const [acct, setAcct] = useState<Account>();
  const [market, setMarket] = useState<Market>();
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
        const who = account ?? NOBODY;
        const per = await publicClient.multicall({
          allowFailure: false,
          contracts: STOCK_RESERVES.flatMap((r) => [
            { address: AAVE_ORACLE, abi: aaveOracleAbi, functionName: "getReservePrice", args: [r.reserveId] } as const,
            { address: r.token, abi: erc20Abi, functionName: "balanceOf", args: [who] } as const,
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserSuppliedAssets", args: [r.reserveId, who] } as const,
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserReserveStatus", args: [r.reserveId, who] } as const,
          ]),
        });
        const glob = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserAccountData", args: [who] },
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getUserTotalDebt", args: [USDC_RESERVE.reserveId, who] },
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getReserveSuppliedAssets", args: [USDC_RESERVE.reserveId] },
            { address: AAVE_SPOKE, abi: spokeAbi, functionName: "getReserveTotalDebt", args: [USDC_RESERVE.reserveId] },
          ],
        });
        const api = await fetch("/api/aave/markets")
          .then((r) => (r.ok ? r.json() : undefined))
          .catch(() => undefined);
        if (dead) return;
        const at = (i: number) => per[i] as unknown;
        setRows(
          STOCK_RESERVES.map((reserve, i) => ({
            reserve,
            price: Number(at(i * 4) as bigint) / 1e8,
            wallet: account ? (at(i * 4 + 1) as bigint) : 0n,
            supplied: account ? (at(i * 4 + 2) as bigint) : 0n,
            usingAsCollateral: account ? (at(i * 4 + 3) as readonly [boolean, boolean])[0] : false,
          })),
        );
        const a = glob[0] as unknown as readonly bigint[];
        const debtRaw = glob[1] as unknown as bigint;
        const usdcSupplied = glob[2] as unknown as bigint;
        const usdcBorrowed = glob[3] as unknown as bigint;
        const debtUsd = account ? Number(a[4]) / RAY / VALUE_SCALE : 0;
        setAcct({
          collateralUsd: account ? Number(a[3]) / VALUE_SCALE : 0,
          avgCollateralFactor: account ? Number(a[1]) / 1e18 : 0,
          debtUsd,
          debtRaw: account ? debtRaw : 0n,
          health: debtUsd > 0 ? Number(a[2]) / 1e18 : Infinity,
        });
        const apiRows = (api?.reserves ?? []) as { symbol: string; collateralFactor: number; borrowApy: number; borrowable: number }[];
        const usdc = apiRows.find((r) => r.symbol === "USDC");
        setMarket({
          usdcAvailable: usdc?.borrowable ?? Math.max(0, Number(usdcSupplied - usdcBorrowed) / 1e6),
          borrowApy: usdc?.borrowApy,
          factors: Object.fromEntries(apiRows.filter((r) => r.collateralFactor > 0).map((r) => [r.symbol, r.collateralFactor])),
        });
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
    async (calls: SendCall[], attestNonUS: boolean) => {
      setError(undefined);
      setHashes([]);
      const out: Hash[] = [];
      try {
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        if (!attestNonUS) throw new Error("Please confirm you are not a US person");
        const geo = await fetch("/api/geo").then((r) => r.json()).catch(() => ({}));
        if (geo?.tradingBlocked) throw new Error("Borrowing is not available in your region.");
        const suffix = requireDataSuffix();
        for (const c of calls) if (!c.checked) assertSafe(c, account);
        if ((await walletClient.getChainId()) !== base.id) await walletClient.switchChain({ id: base.id });

        const caps = await getBaseCapabilities(walletClient, account);
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
            setHashes([...out]);
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
        setStep(undefined);
        // Some txs already went through (one-by-one wallets): say so, keep their links, refresh balances.
        const sent = out.length;
        if (sent > 0) {
          setStatus("error");
          setError(
            `Stopped after ${sent} of ${calls.length} steps (${calls[sent]?.label ?? "next step"} didn't go through). The first ${sent} are done onchain: check your wallet below before trying again.`,
          );
          refresh();
          return;
        }
        setStatus(isUserRejection(e) ? "idle" : "error");
        if (!isUserRejection(e)) setError(shortError(e));
      }
    },
    [walletClient, account, refresh],
  );

  /** Deposit `deposit` (raw stock) and borrow `amount` (raw USDC). Either can be 0. */
  const borrow = useCallback(
    async (row: StockRow, deposit: bigint, amount: bigint, attestNonUS: boolean) => {
      if (!account || !acct || !market) return;
      setError(undefined);
      const r = row.reserve;
      const cf = market.factors[r.symbol] ?? r.collateralFactor;
      const addColl = (Number(deposit) / 1e8) * row.price;
      // Stock already deposited but not switched on as collateral counts once we switch it on.
      const idle = row.usingAsCollateral ? 0 : (Number(row.supplied) / 1e8) * row.price;
      const addDebt = Number(amount) / 1e6;
      if (deposit > row.wallet) return setError(`You don't hold that much ${r.symbol}.`);
      if (addDebt > market.usdcAvailable) return setError("Not enough USDC left to borrow on Aave right now. Try a smaller amount.");
      if (addDebt > 0 && healthAfter(acct, addColl + idle, cf, addDebt) < MIN_HEALTH) {
        return setError(`That would leave your health under ${MIN_HEALTH}. Borrow less or add more stock.`);
      }
      const calls: SendCall[] = [];
      if (deposit > 0n) {
        const allowance = await publicClient.readContract({ address: r.token, abi: erc20Abi, functionName: "allowance", args: [account, AAVE_SPOKE] });
        if (allowance < deposit) {
          calls.push({ to: r.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AAVE_SPOKE, deposit] }), label: `Approve ${r.symbol}` });
        }
        calls.push({ to: AAVE_SPOKE, data: encodeFunctionData({ abi: spokeAbi, functionName: "supply", args: [r.reserveId, deposit, account] }), label: `Deposit ${r.symbol}` });
      }
      if (!row.usingAsCollateral && (deposit > 0n || row.supplied > 0n)) {
        calls.push({
          to: AAVE_SPOKE,
          data: encodeFunctionData({ abi: spokeAbi, functionName: "setUsingAsCollateral", args: [r.reserveId, true, account] }),
          label: `Use ${r.symbol} as collateral`,
        });
      }
      if (amount > 0n) {
        calls.push({ to: AAVE_SPOKE, data: encodeFunctionData({ abi: spokeAbi, functionName: "borrow", args: [USDC_RESERVE.reserveId, amount, account] }), label: "Borrow USDC" });
      }
      if (!calls.length) return;
      return send(calls, attestNonUS);
    },
    [account, acct, market, send],
  );

  /**
   * Buy a stock (or a whole basket) with `spend` USDC, deposit it on Aave and borrow `amount` USDC.
   * Aerodrome only, so each buy has a known minimum out; that minimum is what gets deposited.
   */
  const buyAndBorrow = useCallback(
    async (p: { stock?: string; basketId?: string; spend: bigint; amount: bigint; slippageBps: number; attestNonUS: boolean }) => {
      if (!account || !acct || !market || !rows) return;
      setError(undefined);
      try {
        if (!p.attestNonUS) throw new Error("Please confirm you are not a US person");
        setStatus("confirming");
        setStep("Getting a price from Aerodrome");
        const res = await fetch("/api/swap/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taker: account,
            usdcAmount: formatUnits(p.spend, 6),
            attestNonUS: true,
            slippageBps: p.slippageBps,
            provider: "aerodrome",
            stock: p.stock,
            basketId: p.stock ? undefined : p.basketId,
          }),
        });
        const q = (await res.json()) as PortQuote & { error?: string; message?: string };
        if (res.status === 451) throw new Error("Trading is not available in your region.");
        if (!res.ok) throw new Error(q.message ?? q.error ?? "Quote failed");
        if (q.provider !== "aerodrome") throw new Error("Only the Aerodrome route can be used for Buy and borrow.");
        checkApproval(q.provider, q.approval, p.spend);
        for (const c of q.calls) checkSwapCall(q.provider, c, account);
        // Deposit what the checked swap calldata guarantees, not what the quote says, and spend exactly `spend`.
        const swaps = q.calls.map((c) => decodeFunctionData({ abi: slipstreamRouterAbi, data: c.data }).args[0]);
        if (swaps.reduce((t, x) => t + x.amountIn, 0n) !== p.spend) throw new Error("Stopped for your safety: the swaps don't add up to what you're spending.");
        const minOf = (token: Address) => swaps.filter((x) => isAddressEqual(x.tokenOut, token)).reduce((t, x) => t + x.amountOutMinimum, 0n);

        const usdc = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account] });
        if (usdc < p.spend) throw new Error("Not enough USDC in your wallet.");

        // Collateral we can count on: each leg's guaranteed minimum, on Aave stocks only.
        const legs = q.legs.map((l) => {
          const row = rows.find((r) => r.reserve.symbol === l.symbol);
          return { l, row, min: row ? minOf(row.reserve.token) : 0n };
        });
        if (legs.some((x) => !x.row || x.min === 0n)) throw new Error("One of these stocks can't be used as collateral on Aave.");
        const addWeighted = legs.reduce((s, x) => s + (Number(x.min) / 1e8) * x.row!.price * (market.factors[x.l.symbol] ?? x.row!.reserve.collateralFactor), 0);
        const addDebt = Number(p.amount) / 1e6;
        if (addDebt > market.usdcAvailable) throw new Error("Not enough USDC left to borrow on Aave right now. Try a smaller amount.");
        if (addDebt > 0 && healthAfter(acct, addWeighted, 1, addDebt) < MIN_HEALTH) {
          throw new Error(`That would leave your health under ${MIN_HEALTH}. Borrow less or buy more.`);
        }

        const calls: SendCall[] = [];
        if (q.approval) {
          const allowance = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "allowance", args: [account, q.approval.spender] });
          if (allowance < BigInt(q.approval.amount)) {
            calls.push({
              to: USDC_BASE,
              data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [q.approval.spender, BigInt(q.approval.amount)] }),
              label: "Approve USDC",
              checked: true,
            });
          }
        }
        for (const c of q.calls) calls.push({ to: c.to, data: c.data, label: c.label, checked: true });
        for (const { row, min } of legs) {
          const r = row!.reserve;
          calls.push({ to: r.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AAVE_SPOKE, min] }), label: `Approve ${r.symbol}` });
          calls.push({ to: AAVE_SPOKE, data: encodeFunctionData({ abi: spokeAbi, functionName: "supply", args: [r.reserveId, min, account] }), label: `Deposit ${r.symbol}` });
          if (!row!.usingAsCollateral) {
            calls.push({
              to: AAVE_SPOKE,
              data: encodeFunctionData({ abi: spokeAbi, functionName: "setUsingAsCollateral", args: [r.reserveId, true, account] }),
              label: `Use ${r.symbol} as collateral`,
            });
          }
        }
        if (p.amount > 0n) {
          calls.push({ to: AAVE_SPOKE, data: encodeFunctionData({ abi: spokeAbi, functionName: "borrow", args: [USDC_RESERVE.reserveId, p.amount, account] }), label: "Borrow USDC" });
        }
        return send(calls, p.attestNonUS);
      } catch (e) {
        setStatus(isUserRejection(e) ? "idle" : "error");
        setStep(undefined);
        if (!isUserRejection(e)) setError(shortError(e));
      }
    },
    [account, acct, market, rows, send],
  );

  /** Repay all USDC debt, then withdraw this stock. */
  const repayAndWithdraw = useCallback(
    async (row: StockRow, attestNonUS: boolean) => {
      if (!account || !acct) return;
      setError(undefined);
      const calls: SendCall[] = [];
      if (acct.debtRaw > 0n) {
        const amt = acct.debtRaw + (acct.debtRaw * REPAY_BUFFER_BPS) / 10_000n + REPAY_BUFFER_MIN;
        const usdc = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account] });
        if (usdc < amt) return setError("Not enough USDC in your wallet to repay the full loan.");
        const allowance = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "allowance", args: [account, AAVE_SPOKE] });
        if (allowance < amt) {
          calls.push({ to: USDC_BASE, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AAVE_SPOKE, amt] }), label: "Approve USDC" });
        }
        calls.push({ to: AAVE_SPOKE, data: encodeFunctionData({ abi: spokeAbi, functionName: "repay", args: [USDC_RESERVE.reserveId, amt, account] }), label: "Repay USDC" });
      }
      if (row.supplied > 0n) {
        calls.push({
          to: AAVE_SPOKE,
          data: encodeFunctionData({ abi: spokeAbi, functionName: "withdraw", args: [row.reserve.reserveId, row.supplied, account] }),
          label: `Withdraw ${row.reserve.symbol}`,
        });
      }
      if (!calls.length) return;
      return send(calls, attestNonUS);
    },
    [account, acct, send],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setHashes([]);
  }, []);

  return { rows, acct, market, loadError, borrow, buyAndBorrow, repayAndWithdraw, status, step, error, hashes, reset, refresh, builderCodeConfigured: !!DATA_SUFFIX };
}
