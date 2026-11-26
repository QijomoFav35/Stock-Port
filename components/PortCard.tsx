"use client";
import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import ConnectButton from "@/components/ConnectButton";
import ReviewPanel from "@/components/ReviewPanel";
import SafetyNote from "@/components/SafetyNote";
import ShareButtons from "@/components/ShareButtons";
import Icon from "@/components/Icon";
import { usePortBundle } from "@/hooks/usePortBundle";
import { MAX_PORT_USDC, MIN_PORT_USDC } from "@/lib/constants";

const ATTEST_KEY = "sp_attest_non_us";
const PRESETS = [5, 10, 25, 100];
const ROUTE = { o1: "o1 Exchange", "0x": "0x", aerodrome: "Aerodrome" } as const;

export default function PortCard({ geoBlocked, basket }: { geoBlocked: boolean; basket: { id: string; name: string } }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { port, confirm, cancel, plan, status, step, error, result, builderCodeConfigured } = usePortBundle(walletClient, address);
  const [amount, setAmount] = useState("25");
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
      <section className="card pad" style={{ background: "var(--raised)" }}>
        <div className="eyebrow">Buy the basket</div>
        <p style={{ marginTop: 12, fontWeight: 600 }}>Trading isn&apos;t available in your region.</p>
        <p className="muted" style={{ fontSize: 14 }}>
          You can still view the basket and verify every tx onchain.
        </p>
      </section>
    );
  }

  if (result) {
    const spent = Number(result.quote.totalUsdc) / 1e6;
    return (
      <section className="card pad" style={{ textAlign: "center" }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            background: "var(--blue)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 10px rgba(0,0,255,.12)",
          }}
        >
          <Icon name="ph-check" size={40} />
        </div>
        <h3 className="disp" style={{ fontSize: 40, margin: "24px 0 0" }}>
          You&apos;re in.
        </h3>
        <p className="muted" style={{ marginTop: 8 }}>
          Your bag now matches the basket. ${spent.toFixed(2)} routed via {ROUTE[result.quote.provider]}
          {result.mode === "batch" ? " in one batched tx." : ` in ${result.txHashes.length} txs.`}
        </p>
        <ShareButtons hashes={result.txHashes} spent={spent} basket={basket} />
        <div style={{ marginTop: 16, display: "grid", gap: 4, fontSize: 14 }}>
          {result.txHashes.map((h, i) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
              View tx {result.txHashes.length > 1 ? i + 1 : ""} on Basescan <Icon name="ph-arrow-up-right" size={14} />
            </a>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section id="port" className="card pad">
      <div className="eyebrow">Buy {basket.name}</div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 16,
          paddingBottom: 12,
          borderBottom: "2px solid var(--blue)",
          cursor: "text",
        }}
      >
        <span className="num" style={{ fontSize: 56, lineHeight: 1 }}>
          $
        </span>
        <input
          inputMode="decimal"
          aria-label="Amount in USDC"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          disabled={busy || status === "review"}
          className="num"
          style={{ fontSize: 56, lineHeight: 1, border: 0, outline: "none", background: "transparent", width: "100%", minWidth: 0, color: "var(--ink)", padding: 0 }}
        />
        <span
          className="nowrap"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, background: "var(--raised)", fontWeight: 600, fontSize: 15 }}
        >
          <Icon name="tok-usdc" size={20} />
          USDC
        </span>
      </label>
      <div style={{ fontSize: 13, color: "var(--g60)", marginTop: 8 }}>
        Min ${MIN_PORT_USDC}, max ${MAX_PORT_USDC}. Type an amount or tap one.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        {PRESETS.filter((p) => p <= MAX_PORT_USDC).map((p) => (
          <button key={p} className={`amt ${Number(amount) === p ? "on" : ""}`} onClick={() => setAmount(String(p))} disabled={busy || status === "review"}>
            ${p}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 10, fontSize: 15, color: "var(--g60)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>You get</span>
          <span className="num" style={{ color: "var(--ink)" }}>
            the basket&apos;s tokenized stock mix
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Gas</span>
          <span className="num" style={{ color: "var(--ink)" }}>
            ~$0.02
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Custody</span>
          <span style={{ color: "var(--ink)" }}>Your wallet (self-custody)</span>
        </div>
      </div>

      <label style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 22, minHeight: 44, fontSize: 14, color: "var(--g80)", cursor: "pointer" }}>
        <input type="checkbox" checked={attest} onChange={(e) => onAttest(e.target.checked)} style={{ width: 22, height: 22, flex: "none" }} />
        I confirm I&apos;m not a US person, not in the US and not in a restricted or sanctioned region.
      </label>

      {!builderCodeConfigured && (
        <p className="err">Builder Code missing (NEXT_PUBLIC_BASE_BUILDER_CODE). Sending disabled.</p>
      )}

      <div style={{ marginTop: 12 }}>
        {!address ? (
          <ConnectButton full />
        ) : status === "review" && plan ? (
          <ReviewPanel plan={plan} onConfirm={confirm} onCancel={cancel} />
        ) : (
          <>
            <button
              onClick={() => port(amount, { attestNonUS: attest, review: true, basketId: basket.id }).catch(() => {})}
              disabled={!attest || !validAmount || busy || !builderCodeConfigured}
              className="btn btn-blue"
              style={{ width: "100%", height: 58, fontSize: 17 }}
            >
              {busy ? step ?? "Working…" : `Review tx · $${amount || 0}`}
            </button>
            {!attest && (
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--g60)", marginTop: 8 }}>Tick the box above to continue</div>
            )}
          </>
        )}
      </div>

      {error && <p className="err">{error}</p>}
      <SafetyNote />
    </section>
  );
}
