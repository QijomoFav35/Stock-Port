"use client";
/**
 * Dust to Stocks: sweep small token balances into USDC (0x), then buy the basket with the USDC
 * that actually arrived (usePortBundle, o1 first).
 *
 * Step 1 – sweep. EIP-5792 wallets get one confirmation for every approve + swap. Other wallets
 *   go token by token; a failed token is marked and skipped, a rejected prompt stops the sweep.
 * Step 2 – buy. USDC balance after minus before = what the sweep produced. If that's at least
 *   MIN_DUST_PORT_USDC, it is ported into the basket. Otherwise it stays in the wallet as USDC.
 * Builder Code goes on every transaction (capability or calldata suffix).
 */
import { useCallback, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, type Address, type Hash, type Hex, type WalletClient } from "viem";
import { base } from "viem/chains";
import { requireDataSuffix, withBuilderCode } from "@/lib/attribution";
import { MIN_DUST_PORT_USDC, USDC_BASE, USDC_DECIMALS } from "@/lib/constants";
import { publicClient } from "@/lib/publicClient";
import { getBaseCapabilities, isUserRejection, shortError } from "@/lib/walletCaps";
import type { DustScan, DustToken } from "@/app/api/swap/dust/scan/route";
import type { DustQuote } from "@/app/api/swap/dust/quote/route";
import type { PortOpts, PortResult } from "@/hooks/usePortBundle";

export type TokenStatus =
  | { state: "waiting" }
  | { state: "swapping" }
  | { state: "done"; hash?: Hash }
  | { state: "failed"; reason: string };

export type SweepPhase = "idle" | "scanning" | "ready" | "quoting" | "sweeping" | "buying" | "done" | "error";
export type SweepResult = { sweptUsdc: string; sweepHashes: Hash[]; port?: PortResult; keptAsUsdc: boolean };

const SKIP_TEXT: Record<string, string> = {
  no_route: "No swap route",
  price_impact: "Price impact too high",
  gas_too_high: "Gas costs more than it's worth",
  quote_failed: "Couldn't get a quote",
};

type Call = { to: Address; data: Hex; value: Hex };

export function useDustSweep(
  walletClient: WalletClient | undefined,
  account: Address | undefined,
  port: (usdcAmount: string, opts: PortOpts) => Promise<PortResult>,
) {
  const [phase, setPhase] = useState<SweepPhase>("idle");
  const [tokens, setTokens] = useState<DustToken[]>([]);
  const [hiddenUnpriced, setHiddenUnpriced] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, TokenStatus>>({});
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SweepResult>();

  const mark = (token: Address, s: TokenStatus) => setStatuses((prev) => ({ ...prev, [token.toLowerCase()]: s }));

  const scan = useCallback(async () => {
    if (!account) return;
    setPhase("scanning");
    setError(undefined);
    setResult(undefined);
    setStatuses({});
    try {
      const res = await fetch("/api/swap/dust/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: account }),
      });
      const body = (await res.json()) as DustScan & { error?: string; message?: string };
      if (res.status === 451) throw new Error("Trading is not available in your region.");
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Scan failed");
      setTokens(body.tokens);
      setHiddenUnpriced(body.hiddenUnpriced);
      setPhase("ready");
    } catch (e) {
      setError(shortError(e));
      setPhase("error");
    }
  }, [account]);

  const sweep = useCallback(
    async (selected: DustToken[], opts: { attestNonUS: boolean }) => {
      setError(undefined);
      setResult(undefined);
      let buying = false;
      try {
        if (!walletClient || !account) throw new Error("Connect a wallet first");
        if (!opts.attestNonUS) throw new Error("Please confirm you are not a US person");
        if (!selected.length) throw new Error("Pick at least one token");
        const suffix = requireDataSuffix();
        if ((await walletClient.getChainId()) !== base.id) await walletClient.switchChain({ id: base.id });

        selected.forEach((t) => mark(t.token, { state: "waiting" }));
        setPhase("quoting");
        setStep("Finding routes for your dust");
        const res = await fetch("/api/swap/dust/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taker: account,
            attestNonUS: true,
            tokens: selected.map((t) => ({ token: t.token, raw: t.raw, valueUsd: t.valueUsd })),
          }),
        });
        const quote = (await res.json()) as DustQuote & { error?: string; message?: string };
        if (res.status === 451) throw new Error("Trading is not available in your region.");
        if (!res.ok) throw new Error(quote.message ?? quote.error ?? "Quote failed");
        for (const s of quote.skipped) mark(s.token, { state: "failed", reason: SKIP_TEXT[s.reason] ?? s.reason });
        if (!quote.legs.length) throw new Error("None of the selected tokens can be swapped right now.");

        // Approvals only where the current allowance is short.
        const allowances = await Promise.all(
          quote.legs.map((l) =>
            publicClient.readContract({
              address: l.token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, l.spender],
            }),
          ),
        );
        const perToken: { token: Address; label: string; calls: Call[] }[] = quote.legs.map((l, i) => {
          const sym = selected.find((t) => t.token.toLowerCase() === l.token.toLowerCase())?.symbol ?? "token";
          const calls: Call[] = [];
          if (allowances[i] < BigInt(l.sellAmount)) {
            calls.push({
              to: l.token,
              data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [l.spender, BigInt(l.sellAmount)] }),
              value: "0x0",
            });
          }
          calls.push(l.call);
          return { token: l.token, label: sym, calls };
        });

        const usdcBefore = await publicClient.readContract({
          address: USDC_BASE,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        });

        setPhase("sweeping");
        const caps = await getBaseCapabilities(walletClient, account);
        const sweepHashes: Hash[] = [];
        if (caps.atomic) {
          setStep(`Confirm ${perToken.length} swaps in one go`);
          perToken.forEach((p) => mark(p.token, { state: "swapping" }));
          const { id } = await walletClient.sendCalls({
            account,
            chain: base,
            forceAtomic: true,
            calls: perToken.flatMap((p) =>
              p.calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: caps.dataSuffix ? c.data : withBuilderCode(c.data) })),
            ),
            capabilities: caps.dataSuffix ? { dataSuffix: { value: suffix, optional: false } } : undefined,
          });
          setStep("Waiting for Base confirmation");
          const st = await walletClient.waitForCallsStatus({ id, timeout: 120_000 });
          sweepHashes.push(...new Set((st.receipts ?? []).map((r) => r.transactionHash)));
          const ok = st.status === "success";
          perToken.forEach((p) =>
            mark(p.token, ok ? { state: "done", hash: sweepHashes[0] } : { state: "failed", reason: "Bundle reverted" }),
          );
          if (!ok) throw new Error("The swap bundle failed onchain. Nothing was swapped.");
        } else {
          for (const [i, p] of perToken.entries()) {
            mark(p.token, { state: "swapping" });
            try {
              let last: Hash | undefined;
              for (const c of p.calls) {
                setStep(`${p.label} (${i + 1}/${perToken.length}): confirm in wallet`);
                const hash = await walletClient.sendTransaction({
                  account,
                  chain: base,
                  to: c.to,
                  value: BigInt(c.value),
                  data: withBuilderCode(c.data),
                });
                setStep(`${p.label}: waiting for confirmation`);
                const r = await publicClient.waitForTransactionReceipt({ hash });
                if (r.status !== "success") throw new Error("Transaction reverted");
                last = hash;
              }
              if (last) sweepHashes.push(last);
              mark(p.token, { state: "done", hash: last });
            } catch (e) {
              if (isUserRejection(e)) {
                perToken.slice(i).forEach((q) => mark(q.token, { state: "failed", reason: "Stopped" }));
                break;
              }
              mark(p.token, { state: "failed", reason: shortError(e) });
            }
          }
        }

        const usdcAfter = await publicClient.readContract({
          address: USDC_BASE,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        });
        const swept = usdcAfter > usdcBefore ? usdcAfter - usdcBefore : 0n;
        const sweptUsdc = formatUnits(swept, USDC_DECIMALS);
        if (Number(sweptUsdc) < MIN_DUST_PORT_USDC) {
          const out = { sweptUsdc, sweepHashes, keptAsUsdc: true };
          setResult(out);
          setPhase("done");
          setStep(undefined);
          return out;
        }

        setPhase("buying");
        buying = true;
        setStep("Buying the basket with your swept USDC");
        // Truncate to cents so the quote never asks for more than arrived.
        const amount = (Math.floor(Number(sweptUsdc) * 100) / 100).toFixed(2);
        const portResult = await port(amount, { attestNonUS: true, purpose: "dust" });
        const out = { sweptUsdc, sweepHashes, port: portResult, keptAsUsdc: false };
        setResult(out);
        setPhase("done");
        setStep(undefined);
        return out;
      } catch (e) {
        setError(
          buying
            ? `Your dust was swapped, but the basket buy didn't go through, so the USDC is in your wallet. ${shortError(e)}`
            : shortError(e),
        );
        setPhase("error");
        setStep(undefined);
      }
    },
    [walletClient, account, port],
  );

  return { phase, tokens, hiddenUnpriced, statuses, step, error, result, scan, sweep };
}
