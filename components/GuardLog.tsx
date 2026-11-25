"use client";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";

type Entry = { at: number; user: string; health: number; trigger: number; amount: string; tx?: string; error?: string };
type Run = { at: number; checked: number; atRisk: number; protected: number; entries: Entry[] };
type Stats = { deployed: boolean; guarded?: number; totalRepaid?: string; protectCount?: number; log?: Run[] };

const usd = (raw: string) => "$" + Number(formatUnits(BigInt(raw || "0"), 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/** Public Agent log for Loan Guard: onchain totals plus the keeper's latest passes. */
export default function GuardLog() {
  const [stats, setStats] = useState<Stats>();

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/guard/stats")
        .then((r) => r.json())
        .then((s: Stats) => live && setStats(s))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!stats?.deployed) return null;
  const runs = stats.log ?? [];
  const actions = runs.flatMap((r) => r.entries).slice(0, 8);

  return (
    <div style={{ marginTop: 20 }}>
      <div className="eyebrow">Agent log</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
        {[
          ["Loans guarded", String(stats.guarded ?? 0)],
          ["Top-ups", String(stats.protectCount ?? 0)],
          ["USDC repaid", usd(stats.totalRepaid ?? "0")],
        ].map(([k, v]) => (
          <div key={k} className="soft" style={{ padding: 14, borderRadius: 14 }}>
            <div style={{ fontSize: 12, color: "var(--g60)" }}>{k}</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 13, display: "grid", gap: 6 }}>
        {runs[0] && (
          <div className="muted">
            Last check {ago(runs[0].at)}: {runs[0].checked} loans, {runs[0].atRisk} under trigger.
          </div>
        )}
        {actions.map((e, i) => (
          <div key={i} className="rule num">
            <span>
              {ago(e.at)} · {e.user} · health {e.health.toFixed(2)} under {e.trigger.toFixed(2)}
            </span>
            <span>
              {e.tx ? (
                <a href={`https://basescan.org/tx/${e.tx}`} target="_blank" rel="noreferrer">
                  Repaid {usd(e.amount)}
                </a>
              ) : (
                <span style={{ color: "var(--red)" }}>{e.error ?? "pending"}</span>
              )}
            </span>
          </div>
        ))}
        {!runs.length && <div className="muted">The agent checks every guarded loan every few minutes. Its moves show up here.</div>}
      </div>
    </div>
  );
}
