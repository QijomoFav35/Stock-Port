"use client";
/**
 * AutoPilot Auto mode: deposit USDC, write your rules onchain (and pick the agent), pause, or exit.
 * Every call is checked before the wallet opens: only USDC approvals to AutoPilot, and only AutoPilot's
 * own user functions.
 */
import { useCallback, useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import { sendCallsCapabilities } from "@/lib/paymaster";
import { USDC_BASE } from "@/lib/constants";
import { AUTOPILOT, autoPilotAbi, parsePilot, pilotArgs, type OnchainPilot } from "@/lib/autopilotContract";
import type { AutoRules } from "@/lib/autopilot";

export type PilotState = {
  pilot: OnchainPilot;
  /** Raw balances inside AutoPilot, by token address (lowercase). USDC included. */
  inside: Record<string, bigint>;
  walletUsdc: bigint;
};
type SendCall = { to: Address; data: Hex; label: string };

function assertSafe(c: SendCall, ap: Address) {
  const stop = (why: string): never => {
    throw new Error(`Stopped for your safety: ${why}. Nothing was sent to your wallet.`);
  };
  if (isAddressEqual(c.to, USDC_BASE)) {
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
    const spender = (d.args as readonly unknown[] | undefined)?.[0] as Address | undefined;
    if (d.functionName !== "approve" || !spender || !isAddressEqual(spender, ap)) stop("USDC call other than an approval to AutoPilot");
    return;
  }
  if (!isAddressEqual(c.to, ap)) stop("call to an unknown contract");
  const d = decodeFunctionData({ abi: autoPilotAbi, data: c.data });
  if (!["setPilot", "deposit", "withdraw", "exit"].includes(d.functionName)) stop("unexpected AutoPilot function");
}

export function useAutoPilot(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [state, setState] = useState<PilotState>();
  const [status, setStatus] = useState<"idle" | "confirming" | "pending" | "success" | "error">("idle");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [hashes, setHashes] = useState<Hash[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!AUTOPILOT || !account) return setState(undefined);
    const ap = AUTOPILOT;
    let dead = false;
    (async () => {
      const n = await publicClient.readContract({ address: ap, abi: autoPilotAbi, functionName: "stockCount" });
      const tokens = (await publicClient.multicall({
        allowFailure: false,
        contracts: Array.from({ length: Number(n) }, (_, i) => ({ address: ap, abi: autoPilotAbi, functionName: "stockList", args: [BigInt(i)] }) as const),
      })) as unknown as Address[];
      const all = [USDC_BASE, ...tokens];
      const [p, w, bals] = await Promise.all([
        publicClient.readContract({ address: ap, abi: autoPilotAbi, functionName: "pilots", args: [account] }),
        publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        publicClient.multicall({
          allowFailure: false,
          contracts: all.map((t) => ({ address: ap, abi: autoPilotAbi, functionName: "balances", args: [account, t] }) as const),
        }),
      ]);
      if (dead) return;
      setState({
        pilot: parsePilot(p as unknown as readonly unknown[]),
        walletUsdc: w as bigint,
        inside: Object.fromEntries(all.map((t, i) => [t.toLowerCase(), bals[i] as bigint])),
      });
    })().catch((e) => !dead && setError(shortError(e)));
    return () => {
      dead = true;
    };
  }, [account, tick]);

  const send = useCallback(
    async (calls: SendCall[]) => {
      setError(undefined);
      setHashes([]);
      try {
        if (!AUTOPILOT) throw new Error("AutoPilot isn't deployed yet.");
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        const suffix = requireDataSuffix();
        for (const c of calls) assertSafe(c, AUTOPILOT);
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

  /** Write rules, pick the agent, switch on or off, and optionally add USDC, in one confirmation where the wallet allows. */
  const save = useCallback(
    async (p: { agent: Address; on: boolean; rules: AutoRules; slippagePct: number; deposit: bigint }) => {
      if (!AUTOPILOT || !account) return send([]);
      const calls: SendCall[] = [];
      if (p.deposit > 0n) {
        const allowance = await publicClient.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "allowance", args: [account, AUTOPILOT] });
        if (allowance < p.deposit) {
          calls.push({ to: USDC_BASE, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AUTOPILOT, p.deposit] }), label: "Approve USDC" });
        }
        calls.push({ to: AUTOPILOT, data: encodeFunctionData({ abi: autoPilotAbi, functionName: "deposit", args: [USDC_BASE, p.deposit] }), label: "Deposit USDC" });
      }
      calls.push({
        to: AUTOPILOT,
        data: encodeFunctionData({ abi: autoPilotAbi, functionName: "setPilot", args: pilotArgs(p.agent, p.on, p.rules, p.slippagePct) }),
        label: p.on ? "Save your rules onchain" : "Pause the agent",
      });
      return send(calls);
    },
    [account, send],
  );

  const exit = useCallback(() => {
    if (!AUTOPILOT) return send([]);
    return send([{ to: AUTOPILOT, data: encodeFunctionData({ abi: autoPilotAbi, functionName: "exit", args: [] }), label: "Withdraw everything" }]);
  }, [send]);

  return { deployed: !!AUTOPILOT, state, save, exit, status, step, error, hashes, refresh: () => setTick((t) => t + 1) };
}
