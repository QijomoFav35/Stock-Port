"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentReport, LoanView } from "@/lib/guardAgent";

function dur(ms: number) {
  const h = Math.floor(ms / 3600_000);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${h}h ${Math.round((ms % 3600_000) / 60_000)}m`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}
function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
const DECISION: Record<LoanView["decision"], { label: string; cls: string }> = {
  protect: { label: "Repaying", cls: "ag-protect" },
  warn: { label: "Watching", cls: "ag-warn" },
  hold: { label: "Safe", cls: "ag-hold" },
};

/** The Guard Agent at work: market clock, NAV gaps, its reasoning log and the loans it is watching. */
export default function GuardAgent({ compact = false }: { compact?: boolean }) {
  const [r, setR] = useState<AgentReport>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/agent")
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
        .then((rep: AgentReport) => {
          if (!live) return;
          const first = seen.current.size === 0;
          const added = new Set<string>();
          for (const l of rep.log) {
            const k = l.at + l.text;
            if (!first && !seen.current.has(k)) added.add(k);
            seen.current.add(k);
          }
          setFresh(added);
          setR(rep);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    load();
    const id = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => {
      live = false;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="card pad ag">
      <div className="ag-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="eyebrow">Guard Agent · live</span>
        {r && (
          <span className={`ag-clock ${r.marketClosed ? "ag-closed" : ""}`}>
            {r.marketClosed ? "Markets closed, NAV frozen" : "Markets open"}
            {r.flipInMs > 0 && now > 0 && ` · ${r.marketClosed ? "opens" : "shield on"} in ${dur(Math.max(0, r.flipInMs - (now - r.at)))}`}
          </span>
        )}
      </div>

      {!r && !failed && <p className="muted" style={{ marginTop: 14 }}>The agent is reading Base…</p>}
      {!r && failed && <p className="err">Couldn&apos;t reach the agent right now.</p>}

      {r && (
        <>
          <div className="grid-3" style={{ marginTop: 14 }}>
            {[
              ["Aave stock loans watched", String(r.borrowers)],
              ["Guarded by Loan Guard", String(r.guarded)],
              ["Flagged right now", String(r.loans.filter((l) => l.decision !== "hold").length)],
            ].map(([k, v]) => (
              <div key={k} className="soft stat">
                <div className="stat-k">{k}</div>
                <div className="num stat-v">{v}</div>
              </div>
            ))}
          </div>

          {r.drift.length > 0 && (
            <div className="ag-drift" aria-label="Pool price versus NAV">
              {r.drift.slice(0, compact ? 4 : 8).map((d) => (
                <span key={d.symbol} className="ag-chip num">
                  {d.symbol} <b className={d.pct < 0 ? "ag-neg" : "ag-pos"}>{d.pct >= 0 ? "+" : ""}{d.pct.toFixed(2)}%</b> vs NAV
                </span>
              ))}
            </div>
          )}

          <div className="ag-log" aria-live="polite">
            {r.log.slice(0, compact ? 5 : 10).map((l) => (
              <div key={l.at + l.text} className={`ag-line${fresh.has(l.at + l.text) ? " live-new" : ""}`}>
                <span className="num muted ag-time">{now ? ago(now - l.at) : ""}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>

          {!compact && r.loans.length > 0 && (
            <div className="ag-loans">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Loans on watch</div>
              {r.loans.map((l) => (
                <div key={l.user} className="ag-loan">
                  <span className="num">{l.user}</span>
                  <span className="muted ag-mix">{l.collateral.join(" · ")}</span>
                  <span className="num">
                    {l.health.toFixed(2)} → <b>{l.projected.toFixed(2)}</b>
                  </span>
                  {l.guarded && <span className="live-tag">Guarded</span>}
                  <span className={`ag-dec ${DECISION[l.decision].cls}`}>{DECISION[l.decision].label}</span>
                  <span className="muted ag-why">{l.why}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Health → projected: today&apos;s Aave health, then where live pool prices point at the next open. Every number is read from Base each
        minute. Repayments run through the LoanGuard contract, which re-checks every rule onchain.
      </p>
    </div>
  );
}
