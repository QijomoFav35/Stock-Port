"use client";
/**
 * Rotate between baskets: [approve each stock sold, sell legs, approve USDC, buy legs].
 * One EIP-5792 atomic batch when the wallet supports it, so the buy can never run without the sells
 * (and nothing moves if any leg fails). Otherwise sequential txs, waiting for each receipt.
 * Every call is checked by lib/txGuard.ts before the wallet opens.
 */
import { useCallback, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { DATA_SUFFIX, requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import { checkApproval, checkSellApproval, checkSellCall, checkSwapCall, contractName } from "@/lib/txGuard";
import { sendCallsCapabilities } from "@/lib/paymaster";
import type { RotateQuote } from "@/lib/rotateQuote";

export type RotateStatus = "idle" | "quoting" | "review" | "confirming" | "pending" | "success" | "error";
export type RotateResult = { mode: "batch" | "sequential"; txHashes: Hash[]; quote: RotateQuote };
type SendCall = { to: Address; data: Hex; value: Hex; label: string };

const approveCall = (token: Address, spender: Address, amount: bigint, label: string): SendCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  value: "0x0",
  label,
});

export function useRotate(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [status, setStatus] = useState<RotateStatus>("idle");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [quote, setQuote] = useState<RotateQuote>();
  const [result, setResult] = useState<RotateResult>();
  const decideRef = useRef<(ok: boolean) => void>(undefined);
  const confirm = useCallback(() => decideRef.current?.(true), []);
  const cancel = useCallback(() => decideRef.current?.(false), []);

  const rotate = useCallback(
    async (from: string, to: string, attestNonUS: boolean) => {
      setError(undefined);
      setResult(undefined);
      setQuote(undefined);
      try {
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        if (!attestNonUS) throw new Error("Please confirm you are not a US person");
        const suffix = requireDataSuffix();
        if ((await walletClient.getChainId()) !== base.id) await walletClient.switchChain({ id: base.id });

        setStatus("quoting");
        setStep("Reading your bag and pricing the rotation");
        const res = await fetch("/api/swap/rotate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taker: account, from, to, attestNonUS: true }),
        });
        const q = (await res.json()) as RotateQuote & { error?: string; message?: string };
        if (res.status === 451) throw new Error("Trading is not available in your region.");
        if (!res.ok) throw new Error(q.message ?? q.error ?? "Rotation quote failed");

        // Safety checks before anything reaches the wallet.
        for (const a of q.sells.approvals) {
          const leg = q.sells.legs.find((l) => l.token.toLowerCase() === a.token.toLowerCase());
          checkSellApproval(leg?.provider ?? "aerodrome", a, q.sells.legs);
        }
        for (const c of q.sells.calls) checkSellCall(c.provider, c, account, q.sells.legs);
        const usdcIn = BigInt(q.usdcIn);
        checkApproval(q.buy.provider, q.buy.approval, usdcIn);
        for (const c of q.buy.calls) checkSwapCall(q.buy.provider, c, account);
        if (q.buy.calls.some((c) => c.permit2)) throw new Error("This route needs a signature step Rotate doesn't support yet.");

        setQuote(q);
        setStatus("review");
        setStep("Review and confirm");
        const ok = await new Promise<boolean>((resolve) => {
          decideRef.current = resolve;
        });
        decideRef.current = undefined;
        if (!ok) {
          setQuote(undefined);
          setStatus("idle");
          setStep(undefined);
          return;
        }
        if (Date.now() > q.expiresAt + 60_000) throw new Error("Prices moved while you were reviewing. Tap Rotate again.");

        const calls: SendCall[] = [];
        for (const a of q.sells.approvals) {
          const allowance = await publicClient.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [account, a.spender] });
          if (allowance < BigInt(a.amount)) calls.push(approveCall(a.token, a.spender, BigInt(a.amount), `Approve ${a.symbol}`));
        }
        calls.push(...q.sells.calls.map(({ to: t, data, value, label }) => ({ to: t, data, value, label })));
        if (q.buy.approval) {
          const allowance = await publicClient.readContract({
            address: q.buy.approval.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, q.buy.approval.spender],
          });
          if (allowance < BigInt(q.buy.approval.amount)) {
            calls.push(approveCall(q.buy.approval.token, q.buy.approval.spender, BigInt(q.buy.approval.amount), "Approve USDC"));
          }
        }
        calls.push(...q.buy.calls.map(({ to: t, data, value, label }) => ({ to: t, data, value, label })));

        const caps = await getBaseCapabilities(walletClient, account);
        const txHashes: Hash[] = [];
        let mode: RotateResult["mode"];
        if (caps.atomic) {
          mode = "batch";
          setStatus("confirming");
          setStep("Confirm the rotation in your wallet");
          const { id } = await walletClient.sendCalls({
            account,
            chain: base,
            forceAtomic: true,
            calls: calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: caps.dataSuffix ? c.data : withBuilderCode(c.data) })),
            capabilities: sendCallsCapabilities(caps, suffix),
          });
          setStatus("pending");
          setStep("Waiting for Base confirmation");
          const st = await walletClient.waitForCallsStatus({ id, timeout: 120_000 });
          txHashes.push(...new Set((st.receipts ?? []).map((r) => r.transactionHash)));
          if (st.status !== "success") throw new Error(`Rotation reverted (status ${st.statusCode}). Nothing moved.`);
        } else {
          mode = "sequential";
          for (const [i, c] of calls.entries()) {
            setStatus("confirming");
            setStep(`${c.label} (${i + 1}/${calls.length}): confirm in wallet`);
            const hash = await walletClient.sendTransaction({ account, chain: base, to: c.to, value: BigInt(c.value), data: withBuilderCode(c.data) });
            txHashes.push(hash);
            setStatus("pending");
            setStep(`${c.label}: waiting for confirmation`);
            const r = await publicClient.waitForTransactionReceipt({ hash });
            if (r.status !== "success") {
              throw new Error(`${c.label} reverted (${hash}). Anything sold before this is now USDC in your wallet.`);
            }
          }
        }
        const out = { mode, txHashes, quote: q };
        setResult(out);
        setStatus("success");
        setStep(undefined);
        return out;
      } catch (e) {
        setStatus(isUserRejection(e) ? "idle" : "error");
        setStep(undefined);
        if (!isUserRejection(e)) setError(shortError(e));
      }
    },
    [walletClient, account],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(undefined);
    setQuote(undefined);
    setError(undefined);
  }, []);

  return { rotate, confirm, cancel, reset, quote, status, step, error, result, builderCodeConfigured: !!DATA_SUFFIX };
}

export const usdText = (raw: string | bigint) => "$" + Number(formatUnits(BigInt(raw), 6)).toFixed(2);
export const spenderName = (a: Address) => contractName(a) ?? "o1 swap contract";
