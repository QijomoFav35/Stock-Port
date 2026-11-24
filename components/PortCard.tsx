"use client";
import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import ConnectButton from "@/components/ConnectButton";
import ShareButtons from "@/components/ShareButtons";
import { usePortBundle } from "@/hooks/usePortBundle";
import { MAX_PORT_USDC, MIN_PORT_USDC } from "@/lib/constants";

const ATTEST_KEY = "sp_attest_non_us";

export default function PortCard({ geoBlocked }: { geoBlocked: boolean }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { port, status, step, error, result, builderCodeConfigured } = usePortBundle(walletClient, address);
  const [amount, setAmount] = useState("5");
  const [attest, setAttest] = useState(false);

  useEffect(() => {
    try {
      setAttest(localStorage.getItem(ATTEST_KEY) === "1");
    } catch {}
  }, []);
  const onAttest = (v: boolean) => {
    setAttest(v);
    try {
      localStorage.setItem(ATTEST_KEY, v ? "1" : "0");
    } catch {}
  };

  const n = Number(amount);
  const validAmount = n >= MIN_PORT_USDC && n <= MAX_PORT_USDC;
  const busy = status === "quoting" || status === "signing" || status === "confirming" || status === "pending";

  if (geoBlocked) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
        Trading is not available in your region. You can still view the basket, the Agent&apos;s Port Log and
        public stats.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
      <h2 className="font-semibold">Port USDC</h2>
      <label className="block">
        <span className="text-sm text-neutral-500">Amount (USDC on Base, min ${MIN_PORT_USDC})</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          className="mt-1 w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-lg"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={attest} onChange={(e) => onAttest(e.target.checked)} className="mt-1" />
        <span>
          I confirm I am not a US person, not located in the United States, and not in a sanctioned jurisdiction.
        </span>
      </label>

      {!builderCodeConfigured && (
        <p className="text-sm text-red-600">Builder Code missing (NEXT_PUBLIC_BASE_BUILDER_CODE). Sending disabled.</p>
      )}

      {!address ? (
        <ConnectButton className="w-full" />
      ) : (
        <button
          onClick={() => port(amount, { attestNonUS: attest }).catch(() => {})}
          disabled={!attest || !validAmount || busy || !builderCodeConfigured}
          className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? step ?? "Working…" : `Port $${amount || 0} into the basket`}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="text-sm space-y-1">
          <p className="text-green-600 font-medium">
            Ported via {result.mode === "batch" ? "one batched confirmation" : `${result.txHashes.length} transactions`}.
          </p>
          {result.txHashes.map((h) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" className="block underline truncate">
              {h}
            </a>
          ))}
          <ShareButtons hashes={result.txHashes} spent={Number(result.quote.totalUsdc) / 1e6} />
        </div>
      )}
    </section>
  );
}
