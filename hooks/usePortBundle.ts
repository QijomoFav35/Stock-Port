"use client";
/**
 * 1-Click "Port USDC": [USDC approve if needed, buy leg 1..n].
 *
 * Swap calls come from /api/swap/quote (o1 Exchange by default, 0x as backup).
 * o1 legs may carry a Permit2 EIP-712 payload: we ask the wallet to sign it and splice the
 * signature into the calldata where o1 left its placeholder.
 *
 * Path A (EIP-5792): wallet reports atomic batching → one `wallet_sendCalls` confirmation.
 *   Builder Code goes in the `dataSuffix` capability when the wallet declares it, otherwise
 *   it is appended to every call's calldata so attribution is never dropped. With NEXT_PUBLIC_GASLESS=1
 *   a paymaster capability is added too, so smart wallets can get gas sponsored (lib/paymaster.ts).
 * Path B (EOA fallback): sequential sendTransaction, each with the suffix appended, waiting
 *   for each receipt before the next (swaps need the approve mined).
 */
import { useCallback, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { DATA_SUFFIX, requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { O1_SIGNATURE_PLACEHOLDER, type Eip712 } from "@/lib/o1";
import type { PortCall, PortQuote } from "@/app/api/swap/quote/route";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, shortError } from "@/lib/walletCaps";
import { checkApproval, checkSwapCall, contractName } from "@/lib/txGuard";
import { USDC_DECIMALS } from "@/lib/constants";
import { sendCallsCapabilities } from "@/lib/paymaster";
import type { PegHealth } from "@/lib/peg";

export type PortStatus = "idle" | "quoting" | "review" | "signing" | "confirming" | "pending" | "success" | "error";
export type PortResult = { mode: "batch" | "sequential"; txHashes: Hash[]; quote: PortQuote };
type SendCall = { to: Address; data: Hex; value: Hex; label: string };
export type PortOpts = {
  attestNonUS: boolean;
  slippageBps?: number;
  provider?: "aerodrome" | "o1" | "0x";
  /** "dust" lets a sweep buy the basket with less than the normal $5 minimum. */
  purpose?: "port" | "dust";
  /** Which themed basket to buy (lib/baskets.ts). Server default when omitted. */
  basketId?: string;
  /** Pause on a plain-English summary until the user presses Confirm (see `plan`). */
  review?: boolean;
};

/** What the user is about to sign, shown before the wallet opens. */
export type PortPlan = {
  provider: "aerodrome" | "o1" | "0x";
  totalUsdc: string;
  /** Present only when the current allowance is short. Always the exact amount, never unlimited. */
  approval?: { spender: Address; spenderName: string; usdc: string };
  buys: { symbol: string; token: Address; usdc: string; minOut?: string; peg?: PegHealth }[];
  contracts: { address: Address; name: string }[];
  steps: number;
};

export function usePortBundle(walletClient: WalletClient | undefined, account: Address | undefined) {
  const [status, setStatus] = useState<PortStatus>("idle");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<PortResult>();
  const [plan, setPlan] = useState<PortPlan>();
  const decideRef = useRef<(ok: boolean) => void>(undefined);
  const confirm = useCallback(() => decideRef.current?.(true), []);
  const cancel = useCallback(() => decideRef.current?.(false), []);
  const portRef = useRef<(usdcAmount: string, opts: PortOpts) => Promise<PortResult>>(undefined);

  const port = useCallback(
    async (usdcAmount: string, opts: PortOpts): Promise<PortResult> => {
      setError(undefined);
      setResult(undefined);
      setPlan(undefined);
      try {
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        if (!opts.attestNonUS) throw new Error("Please confirm you are not a US person");
        const suffix = requireDataSuffix(); // refuse to send unattributed txs

        if ((await walletClient.getChainId()) !== base.id) await walletClient.switchChain({ id: base.id });

        setStatus("quoting");
        setStep("Fetching best routes");
        const getQuote = async (provider?: "aerodrome" | "o1" | "0x") => {
          const res = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              taker: account,
              usdcAmount,
              attestNonUS: true,
              slippageBps: opts.slippageBps,
              provider,
              purpose: opts.purpose,
              basketId: opts.basketId,
            }),
          });
          const q = (await res.json()) as PortQuote & { error?: string; message?: string; symbols?: string[] };
          if (res.status === 451) throw new Error("Trading is not available in your region.");
          if (!res.ok) throw new Error(q.message ?? q.symbols?.join(", ") ?? q.error ?? "Quote failed");
          return q;
        };
        let quote = await getQuote(opts.provider);
        // Smart wallets (Base Account, Coinbase Smart Wallet) can't produce the 65-byte signature o1's
        // Permit2 legs need. A deployed smart wallet has code, so route it through Aerodrome instead.
        if (!opts.provider && quote.provider === "o1" && quote.calls.some((c) => c.permit2)) {
          const code = await publicClient.getCode({ address: account });
          if (code && code !== "0x") quote = await getQuote("aerodrome");
        }

        const total = BigInt(quote.totalUsdc);
        const usdc = quote.approval?.token;
        const [balance, allowance] = await Promise.all([
          usdc
            ? publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] })
            : Promise.resolve(total),
          quote.approval
            ? publicClient.readContract({
                address: quote.approval.token,
                abi: erc20Abi,
                functionName: "allowance",
                args: [account, quote.approval.spender],
              })
            : Promise.resolve(0n),
        ]);
        if (balance < total) throw new Error("Not enough USDC on Base");

        // Refuse anything unexpected before the wallet ever opens (lib/txGuard.ts).
        checkApproval(quote.provider, quote.approval, total);
        for (const c of quote.calls) checkSwapCall(quote.provider, c, account);
        const needsApproval = !!quote.approval && allowance < BigInt(quote.approval.amount);

        if (opts.review) {
          const usd = (raw: string | bigint) => formatUnits(BigInt(raw), USDC_DECIMALS);
          const targets = [...new Set([...(needsApproval ? [quote.approval!.spender] : []), ...quote.calls.map((c) => c.to)])];
          setPlan({
            provider: quote.provider,
            totalUsdc: usd(total),
            approval: needsApproval
              ? {
                  spender: quote.approval!.spender,
                  spenderName: contractName(quote.approval!.spender) ?? "Swap contract",
                  usdc: usd(quote.approval!.amount),
                }
              : undefined,
            buys: quote.legs.map((l) => ({
              symbol: l.symbol,
              token: l.token,
              usdc: usd(l.sellAmount),
              minOut: l.minBuyAmount ? formatUnits(BigInt(l.minBuyAmount), l.decimals) : undefined,
              peg: quote.peg?.find((p) => p.symbol === l.symbol),
            })),
            contracts: targets.map((a) => ({ address: a, name: contractName(a) ?? "o1 Exchange order contract" })),
            steps: quote.calls.length + (needsApproval ? 1 : 0),
          });
          setStatus("review");
          setStep("Review and confirm");
          const ok = await new Promise<boolean>((resolve) => {
            decideRef.current = resolve;
          });
          decideRef.current = undefined;
          if (!ok) {
            setPlan(undefined);
            setStatus("idle");
            setStep(undefined);
            throw new Error("cancelled");
          }
          if (Date.now() > quote.expiresAt) {
            // Same amount, same route, fresh prices. Re-checked before anything is signed.
            setStatus("quoting");
            setStep("Refreshing the price");
            const fresh = await getQuote(quote.provider);
            if (fresh.provider !== quote.provider || BigInt(fresh.totalUsdc) !== total) {
              throw new Error("The route changed while you were reviewing. Press Port again.");
            }
            checkApproval(fresh.provider, fresh.approval, total);
            for (const c of fresh.calls) checkSwapCall(fresh.provider, c, account);
            quote = fresh;
          }
        }

        const calls: SendCall[] = [];
        if (needsApproval && quote.approval) {
          calls.push({
            to: quote.approval.token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [quote.approval.spender, BigInt(quote.approval.amount)],
            }),
            value: "0x0",
            label: "Approve USDC",
          });
        }
        const signCount = quote.calls.filter((c) => c.permit2).length;
        let signed = 0;
        try {
          for (const c of quote.calls) {
            if (c.permit2) {
              setStatus("signing");
              setStep(`Sign swap permission ${++signed}/${signCount}`);
            }
            calls.push(await withPermit2(walletClient, account, c));
          }
        } catch (e) {
          // A not-yet-deployed smart wallet has no code, so we only learn it from its signature.
          if (!(e instanceof NonStandardSignatureError)) throw e;
          setStatus("quoting");
          setStep("Switching to a route your wallet supports");
          return await portRef.current!(usdcAmount, { ...opts, provider: "aerodrome" });
        }

        const caps = await getBaseCapabilities(walletClient, account);
        const txHashes: Hash[] = [];
        let mode: PortResult["mode"];

        if (caps.atomic) {
          mode = "batch";
          setStatus("confirming");
          setStep("Confirm the bundle in your wallet");
          const { id } = await walletClient.sendCalls({
            account,
            chain: base,
            forceAtomic: true,
            calls: calls.map((c) => ({
              to: c.to,
              value: BigInt(c.value),
              data: caps.dataSuffix ? c.data : withBuilderCode(c.data),
            })),
            capabilities: sendCallsCapabilities(caps, suffix),
          });
          setStatus("pending");
          setStep("Waiting for Base confirmation");
          const st = await walletClient.waitForCallsStatus({ id, timeout: 120_000 });
          txHashes.push(...new Set((st.receipts ?? []).map((r) => r.transactionHash)));
          if (st.status !== "success") throw new Error(`Bundle failed (status ${st.statusCode})`);
        } else {
          mode = "sequential";
          for (const [i, c] of calls.entries()) {
            setStatus("confirming");
            setStep(`${c.label} (${i + 1}/${calls.length}): confirm in wallet`);
            const hash = await walletClient.sendTransaction({
              account,
              chain: base,
              to: c.to,
              value: BigInt(c.value),
              data: withBuilderCode(c.data),
            });
            txHashes.push(hash);
            setStatus("pending");
            setStep(`${c.label}: waiting for confirmation`);
            const r = await publicClient.waitForTransactionReceipt({ hash });
            if (r.status !== "success") throw new Error(`${c.label} reverted (${hash})`);
          }
        }

        const out = { mode, txHashes, quote };
        setResult(out);
        setStatus("success");
        setStep(undefined);
        // Phase 3: POST txHashes to /api/stats for server-side verification + logging.
        return out;
      } catch (e) {
        if (e instanceof Error && e.message === "cancelled") throw e;
        setStatus("error");
        setError(shortError(e));
        throw e;
      }
    },
    [walletClient, account],
  );
  portRef.current = port;

  return { port, confirm, cancel, plan, status, step, error, result, builderCodeConfigured: !!DATA_SUFFIX };
}

class NonStandardSignatureError extends Error {
  constructor() {
    super("This wallet returned a non-standard signature. o1 Permit2 swaps need an EOA wallet.");
  }
}

/** Signs an o1 Permit2 payload (if any) and splices the signature over o1's placeholder. */
async function withPermit2(wc: WalletClient, account: Address, c: PortCall): Promise<SendCall> {
  if (!c.permit2) return c;
  const idx = c.data.toLowerCase().indexOf(O1_SIGNATURE_PLACEHOLDER);
  if (idx < 0) throw new Error(`${c.label}: Permit2 placeholder not found in calldata`);
  const { domain, types, values } = c.permit2;
  const signature = await wc.signTypedData({
    account,
    domain: domain as Parameters<WalletClient["signTypedData"]>[0]["domain"],
    types: stripDomain(types),
    primaryType: primaryTypeOf(types),
    message: values,
  });
  const sig = signature.slice(2);
  // o1's placeholder is a 65-byte ECDSA sig. Smart-wallet (EIP-1271/6492) signatures are longer
  // and would corrupt the calldata layout, so refuse instead of sending a bad tx.
  if (sig.length !== O1_SIGNATURE_PLACEHOLDER.length) {
    throw new NonStandardSignatureError();
  }
  return { ...c, data: (c.data.slice(0, idx) + sig + c.data.slice(idx + sig.length)) as Hex };
}

function stripDomain(types: Eip712["types"]) {
  const { EIP712Domain: _omit, ...rest } = types;
  void _omit;
  return rest;
}

/** The primary type is the one no other struct references. */
function primaryTypeOf(types: Eip712["types"]): string {
  const names = Object.keys(stripDomain(types));
  const referenced = new Set(
    names.flatMap((n) => types[n].map((f) => f.type.replace(/\[\d*\]$/, ""))),
  );
  const roots = names.filter((n) => !referenced.has(n));
  if (roots.length !== 1) throw new Error("Cannot determine EIP-712 primary type");
  return roots[0];
}
