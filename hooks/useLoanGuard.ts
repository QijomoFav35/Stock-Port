"use client";
/**
 * Turn Loan Guard on, top up or withdraw its USDC reserve, and read its state.
 * Turn on = [let Aave's Giver repay for you (once), set trigger/target, approve USDC exactly, fund].
 * Every call is checked before the wallet opens.
 */
import { useCallback, useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { DATA_SUFFIX, requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import { sendCallsCapabilities } from "@/lib/paymaster";
import { USDC_BASE } from "@/lib/constants";
import { AAVE_SPOKE } from "@/lib/aave";
import { GIVER, LOAN_GUARD, hf, loanGuardAbi, positionManagerAbi } from "@/lib/loanGuard";

export type GuardState = {
  reserve: bigint;
  trigger: number;
  target: number;
  weekendTrigger: number;
  lastProtect: number;
  giverApproved: boolean;
  needed: boolean;
};
type SendCall = { to: Address; data: Hex; label: string };

function assertSafe(c: SendCall, guard: Address) {
  const stop = (why: string): never => {
    throw new Error(`Stopped for your safety: ${why}. Nothing was sent to your wallet.`);
  };
  if (isAddressEqual(c.to, USDC_BASE)) {
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
    const spender = (d.args as readonly unknown[] | undefined)?.[0] as Address | undefined;
    if (d.functionName !== "approve" || !spender || !isAddressEqual(spender, guard)) stop("USDC call other than an approval to Loan Guard");
    return;
  }
  if (isAddressEqual(c.to, AAVE_SPOKE)) {
    const d = decodeFunctionData({ abi: positionManagerAbi, data: c.data });
    const args = d.args as readonly unknown[];
    if (d.functionName !== "setUserPositionManager" || !isAddressEqual(args[0] as Address, GIVER)) stop("Aave call other than approving its Giver");
    return;
  }
  if (!isAddressEqual(c.to, guard)) stop("call to an unknown contract");
  const d = decodeFunctionData({ abi: loanGuardAbi, data: c.data });
  if (!["configure", "fund", "withdraw"].includes(d.functionName)) stop("unexpected Loan Guard function");
}

export function useLoanGuard(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [state, setState] = useState<GuardState>();
  const [status, setStatus] = useState<"idle" | "confirming" | "pending" | "success" | "error">("idle");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [hashes, setHashes] = useState<Hash[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!LOAN_GUARD || !account) return setState(undefined);
    let dead = false;
    publicClient
      .multicall({
        allowFailure: false,
        contracts: [
          { address: LOAN_GUARD, abi: loanGuardAbi, functionName: "guards", args: [account] },
          { address: LOAN_GUARD, abi: loanGuardAbi, functionName: "check", args: [account] },
          { address: AAVE_SPOKE, abi: positionManagerAbi, functionName: "isPositionManager", args: [account, GIVER] },
        ],
      })
      .then(([g, c, ok]) => {
        if (dead) return;
        const gs = g as unknown as readonly bigint[];
        const cs = c as unknown as readonly [boolean, bigint, bigint, bigint];
        setState({
          reserve: gs[0],
          trigger: Number(gs[1]) / 1e18,
          target: Number(gs[2]) / 1e18,
          weekendTrigger: Number(gs[3]) / 1e18,
          lastProtect: Number(gs[4]),
          giverApproved: ok as boolean,
          needed: cs[0],
        });
      })
      .catch((e) => !dead && setError(shortError(e)));
    return () => {
      dead = true;
    };
  }, [account, tick]);

  const send = useCallback(
    async (calls: SendCall[]) => {
      setError(undefined);
      setHashes([]);
      try {
        if (!LOAN_GUARD) throw new Error("Loan Guard isn't deployed yet.");
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        const suffix = requireDataSuffix();
        for (const c of calls) assertSafe(c, LOAN_GUARD);
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
        setTick((t) => t + 1);
      } catch (e) {
        setStatus(isUserRejection(e) ? "idle" : "error");
        setStep(undefined);
        if (!isUserRejection(e)) setError(shortError(e));
      }
    },
    [walletClient, account],
  );

  /** Turn on or update: trigger/target/weekend as plain numbers (1.15 = health 1.15), fund in raw USDC. */
  const arm = useCallback(
    async (trigger: number, target: number, weekendTrigger: number, fund: bigint) => {
      if (!LOAN_GUARD || !account) return send([]);
      const calls: SendCall[] = [];
      if (!state?.giverApproved) {
        calls.push({
          to: AAVE_SPOKE,
          data: encodeFunctionData({ abi: positionManagerAbi, functionName: "setUserPositionManager", args: [GIVER, true] }),
          label: "Let Aave's Giver repay for you",
        });
      }
      calls.push({
        to: LOAN_GUARD,
        data: encodeFunctionData({ abi: loanGuardAbi, functionName: "configure", args: [hf(trigger), hf(target), weekendTrigger ? hf(weekendTrigger) : 0n] }),
        label: "Set your guard",
      });
      if (fund > 0n) {
        const allowance = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "allowance", args: [account, LOAN_GUARD] });
        if (allowance < fund) {
          calls.push({ to: USDC_BASE, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [LOAN_GUARD, fund] }), label: "Approve USDC" });
        }
        calls.push({ to: LOAN_GUARD, data: encodeFunctionData({ abi: loanGuardAbi, functionName: "fund", args: [fund] }), label: "Fund the reserve" });
      }
      return send(calls);
    },
    [account, state, send],
  );

  const withdrawReserve = useCallback(
    (amount: bigint) => {
      if (!LOAN_GUARD) return send([]);
      return send([{ to: LOAN_GUARD, data: encodeFunctionData({ abi: loanGuardAbi, functionName: "withdraw", args: [amount] }), label: "Withdraw reserve" }]);
    },
    [send],
  );

  return { deployed: !!LOAN_GUARD, state, arm, withdrawReserve, status, step, error, hashes, builderCodeConfigured: !!DATA_SUFFIX };
}
