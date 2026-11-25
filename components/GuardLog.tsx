"use client";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { GUARD_PREVIEW } from "@/lib/loanGuard";
import { basescanAddress } from "@/lib/txGuard";

type Stats = {
  deployed: boolean;
  address?: string;
  guarded?: number;
  totalRepaid?: string;
  protectCount?: number;
  recent?: { user: string; at: number }[];
  lastCheck?: { at: number; checked: number; atRisk: number } | null;
};

const usd = (raw: string) => "$" + Number(formatUnits(BigInt(raw || "0"), 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });
function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function sample(): Stats {
  const now = Date.now();
  return {
    deployed: true,
    guarded: 12,
    protectCount: 3,
    totalRepaid: String(1840 * 1e6),
    recent: [
      { user: "0x9e37…E647", at: now - 95 * 60_000 },
      { user: "0x7a10…3b2c", at: now - 3 * 86_400_000 },
      { user: "0x41c2…09aa", at: now - 6 * 86_400_000 },
    ],
    lastCheck: { at: now - 2 * 60_000, checked: 12, atRisk: 0 },
  };
}

/** Public Agent log for Loan Guard. Totals and top-ups are read onchain; anyone can check them on Basescan. */
export default function GuardLog() {
  const [stats, setStats] = useState<Stats>();

  useEffect(() => {
    if (GUARD_PREVIEW) {
      setStats(sample());
      return;
    }
    let live = true;
    const load = () =>
      fetch("/api/guard/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((s: Stats) => {
          if (live) setStats(s);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!stats?.deployed) return null;
  const recent = stats.recent ?? [];

  return (
    <div style={{ marginTop: 12 }}>
      <div className="grid-3">
        {[
          ["Loans guarded", String(stats.guarded ?? 0)],
          ["Top-ups", String(stats.protectCount ?? 0)],
          ["USDC repaid", usd(stats.totalRepaid ?? "0")],
        ].map(([k, v]) => (
          <div key={k} className="soft stat">
            <div className="stat-k">{k}</div>
            <div className="num stat-v">{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 13, display: "grid", gap: 6 }}>
        <div className="muted">
          {GUARD_PREVIEW ? "Agent log · sample data. " : "Agent log. "}
          {stats.lastCheck
            ? `Last check ${ago(stats.lastCheck.at)}: ${stats.lastCheck.checked} loans, ${stats.lastCheck.atRisk} under trigger.`
            : "The agent checks every guarded loan every few minutes."}
        </div>
        {recent.map((r) => (
          <div key={r.user + r.at} className="rule" style={{ minHeight: 44, fontSize: 13 }}>
            <span>
              <span className="num">{r.user}</span> topped up
            </span>
            <span className="num">{ago(r.at)}</span>
          </div>
        ))}
        {stats.address && (
          <a href={`${basescanAddress(stats.address as `0x${string}`)}#events`} target="_blank" rel="noreferrer">
            Every top-up is a public Protected event on Basescan
          </a>
        )}
      </div>
    </div>
  );
}
