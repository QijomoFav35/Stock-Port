"use client";
import SafetyNote from "@/components/SafetyNote";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAccount, useWalletClient } from "wagmi";
import ConnectButton from "@/components/ConnectButton";
import ShareButtons from "@/components/ShareButtons";
import Icon from "@/components/Icon";
import { usePortBundle } from "@/hooks/usePortBundle";
import { useDustSweep, type TokenStatus } from "@/hooks/useDustSweep";
import { DUST_MAX_TOKENS, MIN_DUST_PORT_USDC } from "@/lib/constants";

const ATTEST_KEY = "sp_attest_non_us";
const THRESHOLD_KEY = "sp_dust_threshold";
const THRESHOLDS = [1, 10, 100, 1000];
const usd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function StatusText({ s }: { s?: TokenStatus }) {
  if (!s) return <span style={{ color: "var(--g60)" }}>Liquid</span>;
  if (s.state === "waiting") return <span style={{ color: "var(--g60)" }}>Queued</span>;
  if (s.state === "swapping") return <span style={{ color: "var(--blue)" }}>Swapping…</span>;
  if (s.state === "done") return <span style={{ color: "var(--green)" }}>Swapped</span>;
  return <span className="err-inline">{s.reason}</span>;
}

const card: CSSProperties = { padding: 0, overflow: "hidden" };

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
      <section className="card pad" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <p style={{ fontWeight: 600 }}>Trading isn&apos;t available in your region.</p>
      </section>
    );
  }
  if (!address) {
    return (
      <section className="card pad" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <span style={{ color: "var(--yellow)" }}>
          <Icon name="ph-broom" size={36} />
        </span>
        <p className="disp" style={{ fontSize: 24, margin: "12px 0 4px" }}>
          Find dust tokens
        </p>
        <p className="muted" style={{ fontSize: 15, marginBottom: 20 }}>
          Connect a wallet to scan Base for small balances you can sweep into stocks.
        </p>
        <ConnectButton full />
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 24, alignItems: "start" }}>
      <section className="card" style={card}>
        <div style={{ padding: "24px 24px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="disp" style={{ fontSize: 24, display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: "var(--yellow)" }}>
                <Icon name="ph-broom" size={24} />
              </span>
              {dust.phase === "scanning" ? "Scanning Base…" : `${visible.length} dust tokens found`}
            </div>
            {dust.hiddenUnpriced > 0 && (
              <div style={{ color: "var(--g60)", fontSize: 14 }}>
                + {dust.hiddenUnpriced} with no price (usually spam) · hidden
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} role="group" aria-label="Only tokens worth under">
            <span style={{ color: "var(--g60)", fontSize: 14, marginRight: 4 }}>Dust under</span>
            {THRESHOLDS.map((t) => (
              <button
                key={t}
                className={`amt ${t === threshold ? "on" : ""}`}
                style={{ height: 40, padding: "0 14px", fontSize: 14 }}
                disabled={busy}
                onClick={() => {
                  setThreshold(t);
                  try {
                    localStorage.setItem(THRESHOLD_KEY, String(t));
                  } catch {}
                }}
              >
                ${t.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        </div>

        {visible.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px", borderTop: "1px solid var(--line)", background: "var(--raised)", fontSize: 14, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={allPicked}
              disabled={busy}
              style={{ width: 20, height: 20 }}
              onChange={(e) => setPicked(e.target.checked ? new Set(visible.map((t) => t.token)) : new Set())}
            />
            Select all ({visible.length})
            <button onClick={scan} disabled={busy} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--blue)", font: "inherit", cursor: "pointer" }}>
              Rescan
            </button>
          </label>
        )}

        {dust.phase !== "scanning" && visible.length === 0 && dust.phase !== "error" && (
          <p style={{ padding: "20px 24px", borderTop: "1px solid var(--line)", color: "var(--g60)", fontSize: 14, margin: 0 }}>
            No dust under ${threshold.toLocaleString("en-US")} found. Try a higher limit.
          </p>
        )}

        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 520, overflowY: "auto" }}>
          {visible.map((t) => (
            <li key={t.token} style={{ borderTop: "1px solid var(--line)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", fontSize: 15, cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(t.token)} disabled={busy} onChange={() => toggle(t.token)} style={{ width: 22, height: 22, flex: "none" }} />
                <span className="logo" style={{ width: 36, height: 36 }}>
                  {t.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo} alt="" />
                  ) : (
                    <span className="num" style={{ fontSize: 12 }}>
                      {t.symbol.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ fontWeight: 600 }}>{t.symbol}</b>{" "}
                  <span className="num" style={{ color: "var(--g60)", fontSize: 13 }}>
                    {Number(t.amount).toLocaleString("en-US", { maximumSignificantDigits: 6 })}
                  </span>
                  <span style={{ display: "block", fontSize: 12 }}>
                    <StatusText s={dust.statuses[t.token.toLowerCase()]} />
                  </span>
                </span>
                <span className="num">{usd(t.valueUsd)}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: "grid", gap: 24 }}>
        <section className="card pad">
          <div className="eyebrow">Selected</div>
          <div className="num" style={{ fontSize: 56, lineHeight: 1, marginTop: 10 }}>
            {usd(total)}
          </div>
          <div style={{ color: "var(--g60)", fontSize: 14, marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {selected.length} token{selected.length === 1 ? "" : "s"} → USDC <Icon name="tok-usdc" size={16} /> → the basket
          </div>

          <div style={{ marginTop: 24, display: "grid", gap: 0 }}>
            <div style={{ display: "flex", gap: 14, paddingBottom: 16 }}>
              <span className="num" style={{ width: 28, height: 28, borderRadius: 14, background: "var(--blue)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>
                1
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>Swap dust → USDC</div>
                <div style={{ color: "var(--g60)", fontSize: 14 }}>Routed via 0x · one tx per token · exact approvals</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <span className="num" style={{ width: 28, height: 28, borderRadius: 14, border: "1px solid var(--line-hi)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>
                2
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>Buy the basket</div>
                <div style={{ color: "var(--g60)", fontSize: 14 }}>
                  Under ${MIN_DUST_PORT_USDC} after swaps stays in your wallet as USDC.
                </div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--g60)", marginTop: 16 }}>
            Tokens that would lose more than 10% to slippage or cost more than $0.10 in gas are skipped.
          </p>

          <label style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, minHeight: 44, fontSize: 14, color: "var(--g80)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={attest}
              style={{ width: 22, height: 22, flex: "none" }}
              onChange={(e) => {
                setAttest(e.target.checked);
                try {
                  localStorage.setItem(ATTEST_KEY, e.target.checked ? "1" : "0");
                } catch {}
              }}
            />
            I confirm I&apos;m not a US person, not in the US and not in a restricted or sanctioned region.
          </label>

          {!builderCodeConfigured && (
            <p className="err">Builder Code missing (NEXT_PUBLIC_BASE_BUILDER_CODE). Sending disabled.</p>
          )}

          <button
            onClick={() => dust.sweep(selected, { attestNonUS: attest })}
            disabled={!attest || !selected.length || busy || !builderCodeConfigured}
            className="btn btn-blue"
            style={{ width: "100%", marginTop: 12 }}
          >
            {busy ? dust.step ?? "Working…" : `Sweep ${selected.length} token${selected.length === 1 ? "" : "s"} · ${usd(total)}`}
          </button>
          {!attest && <div style={{ textAlign: "center", fontSize: 13, color: "var(--g60)", marginTop: 8 }}>Tick the box above to continue</div>}

          {dust.error && <p className="err">{dust.error}</p>}
          <SafetyNote />
        </section>

        {dust.result ? (
          <section className="pad" style={{ borderRadius: 24, background: "var(--yellow)", padding: 28 }}>
            <div style={{ fontWeight: 700, fontSize: 18, display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="ph-broom" size={22} />
              {dust.result.keptAsUsdc ? "Dust swept to USDC" : "Dust swept into stocks"}
            </div>
            <p style={{ fontSize: 15, margin: "6px 0 0" }}>
              {dust.result.keptAsUsdc
                ? `Swept $${Number(dust.result.sweptUsdc).toFixed(2)} into USDC. That's under $${MIN_DUST_PORT_USDC}, so it stays in your wallet.`
                : `Swept $${Number(dust.result.sweptUsdc).toFixed(2)} of dust into tokenized stocks.`}
            </p>
            <div style={{ display: "grid", gap: 2, marginTop: 10, fontSize: 13 }}>
              {[...dust.result.sweepHashes, ...(dust.result.port?.txHashes ?? [])].map((h, i) => (
                <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" style={{ color: "var(--ink)", textDecoration: "underline" }}>
                  tx {i + 1} on Basescan
                </a>
              ))}
            </div>
            {dust.result.port && (
              <ShareButtons hashes={[...dust.result.sweepHashes, ...dust.result.port.txHashes]} spent={Number(dust.result.sweptUsdc)} dust />
            )}
          </section>
        ) : (
          <section className="pad" style={{ borderRadius: 24, background: "var(--yellow)", padding: 28 }}>
            <div style={{ fontWeight: 700, fontSize: 18, display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="ph-broom" size={22} />
              Post your sweep card
            </div>
            <p style={{ fontSize: 15, margin: "4px 0 0" }}>After the sweep you get a card for X, read straight from Base.</p>
          </section>
        )}
      </div>
    </div>
  );
}
