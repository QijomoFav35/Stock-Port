"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import ConnectButton from "@/components/ConnectButton";
import ShareButtons from "@/components/ShareButtons";
import { usePortBundle } from "@/hooks/usePortBundle";
import { useDustSweep, type TokenStatus } from "@/hooks/useDustSweep";
import { DUST_MAX_TOKENS, MIN_DUST_PORT_USDC } from "@/lib/constants";

const ATTEST_KEY = "sp_attest_non_us";
const THRESHOLD_KEY = "sp_dust_threshold";
const THRESHOLDS = [1, 10, 100, 1000];
const usd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

function StatusText({ s }: { s?: TokenStatus }) {
  if (!s) return null;
  if (s.state === "waiting") return <span className="text-neutral-500">Waiting</span>;
  if (s.state === "swapping") return <span className="text-blue-600">Swapping…</span>;
  if (s.state === "done") return <span className="text-green-600">Swapped</span>;
  return <span className="text-red-600">{s.reason}</span>;
}

export default function DustCard({ geoBlocked }: { geoBlocked: boolean }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { port, builderCodeConfigured } = usePortBundle(walletClient, address);
  const dust = useDustSweep(walletClient, address, port);
  const { scan } = dust;
  const [threshold, setThreshold] = useState(10);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [attest, setAttest] = useState(false);

  useEffect(() => {
    try {
      setAttest(localStorage.getItem(ATTEST_KEY) === "1");
      const t = Number(localStorage.getItem(THRESHOLD_KEY));
      if (THRESHOLDS.includes(t)) setThreshold(t);
    } catch {}
  }, []);
  useEffect(() => {
    if (address && !geoBlocked) scan();
  }, [address, geoBlocked, scan]);

  const visible = useMemo(() => dust.tokens.filter((t) => t.valueUsd < threshold), [dust.tokens, threshold]);
  const selected = visible.filter((t) => picked.has(t.token)).slice(0, DUST_MAX_TOKENS);
  const total = selected.reduce((s, t) => s + t.valueUsd, 0);
  const busy = ["scanning", "quoting", "sweeping", "buying"].includes(dust.phase);

  const toggle = (token: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  const allPicked = visible.length > 0 && visible.every((t) => picked.has(t.token));

  if (geoBlocked) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
        Trading is not available in your region.
      </section>
    );
  }
  if (!address) {
    return (
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 space-y-3 text-center">
        <p className="text-neutral-500">Connect a wallet to find the small balances you can turn into stocks.</p>
        <ConnectButton className="w-full" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-500 mr-1">Worth less than</span>
        {THRESHOLDS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setThreshold(t);
              try {
                localStorage.setItem(THRESHOLD_KEY, String(t));
              } catch {}
            }}
            disabled={busy}
            className={`rounded-full px-3 py-1 text-sm border ${
              t === threshold
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 dark:border-neutral-700"
            }`}
          >
            ${t.toLocaleString()}
          </button>
        ))}
        <button onClick={scan} disabled={busy} className="ml-auto text-sm underline disabled:opacity-50">
          Refresh
        </button>
      </div>

      {dust.phase === "scanning" && <p className="text-sm text-neutral-500">Scanning your wallet on Base…</p>}

      {dust.phase !== "scanning" && visible.length === 0 && dust.phase !== "error" && (
        <p className="text-sm text-neutral-500">No small balances under ${threshold.toLocaleString()} found.</p>
      )}

      {visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          <label className="flex items-center gap-3 px-3 py-2 text-sm bg-neutral-50 dark:bg-neutral-900">
            <input
              type="checkbox"
              checked={allPicked}
              disabled={busy}
              onChange={(e) => setPicked(e.target.checked ? new Set(visible.map((t) => t.token)) : new Set())}
            />
            <span className="font-medium">Select all ({visible.length})</span>
          </label>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 max-h-96 overflow-y-auto">
            {visible.map((t) => (
              <li key={t.token}>
                <label className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" checked={picked.has(t.token)} disabled={busy} onChange={() => toggle(t.token)} />
                  {t.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo} alt="" className="h-6 w-6 rounded-full" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      {Number(t.amount).toLocaleString(undefined, { maximumSignificantDigits: 6 })}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block">{usd(t.valueUsd)}</span>
                    <span className="block text-xs">
                      <StatusText s={dust.statuses[t.token.toLowerCase()]} />
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dust.hiddenUnpriced > 0 && (
        <p className="text-xs text-neutral-500">
          {dust.hiddenUnpriced} token{dust.hiddenUnpriced === 1 ? "" : "s"} hidden because they have no market price
          (usually spam airdrops).
        </p>
      )}

      <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-3 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-neutral-500">Selected</span>
          <span>
            {selected.length} token{selected.length === 1 ? "" : "s"} · {usd(total)}
          </span>
        </div>
        <p className="text-neutral-500">
          Swapped to USDC, then into the Stock Port basket. Under ${MIN_DUST_PORT_USDC} after swaps stays in your wallet
          as USDC. Tokens that would lose more than 10% or cost more than $0.10 in gas are skipped.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={attest}
          onChange={(e) => {
            setAttest(e.target.checked);
            try {
              localStorage.setItem(ATTEST_KEY, e.target.checked ? "1" : "0");
            } catch {}
          }}
          className="mt-1"
        />
        <span>I confirm I am not a US person, not located in the United States, and not in a sanctioned jurisdiction.</span>
      </label>

      {!builderCodeConfigured && (
        <p className="text-sm text-red-600">Builder Code missing (NEXT_PUBLIC_BASE_BUILDER_CODE). Sending disabled.</p>
      )}

      <button
        onClick={() => dust.sweep(selected, { attestNonUS: attest })}
        disabled={!attest || !selected.length || busy || !builderCodeConfigured}
        className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? dust.step ?? "Working…" : `Turn ${usd(total)} of dust into stocks`}
      </button>

      {dust.error && <p className="text-sm text-red-600">{dust.error}</p>}
      {dust.result && (
        <div className="text-sm space-y-1">
          <p className="text-green-600 font-medium">
            {dust.result.keptAsUsdc
              ? `Swept $${Number(dust.result.sweptUsdc).toFixed(2)} into USDC. That's under $${MIN_DUST_PORT_USDC}, so it stays in your wallet as USDC.`
              : `Turned your dust into $${Number(dust.result.sweptUsdc).toFixed(2)} of stocks.`}
          </p>
          {[...dust.result.sweepHashes, ...(dust.result.port?.txHashes ?? [])].map((h) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" className="block underline truncate">
              {h}
            </a>
          ))}
          {dust.result.port && (
            <ShareButtons
              hashes={[...dust.result.sweepHashes, ...dust.result.port.txHashes]}
              spent={Number(dust.result.sweptUsdc)}
              dust
            />
          )}
        </div>
      )}
    </section>
  );
}
