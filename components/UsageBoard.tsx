"use client";
import { useEffect, useState } from "react";
import { basescanTx } from "@/lib/txGuard";
import type { UsageSummary, UsageKind } from "@/lib/usage";

const KIND: Record<UsageKind, string> = { trade: "Basket or sweep", borrow: "Aave V4 loan", guard: "Loan Guard" };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Live usage, read onchain and verified by Builder Code. Refreshes every minute and keeps catching up after a restart. */
export default function UsageBoard() {
  const [u, setU] = useState<UsageSummary>();
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((s: UsageSummary) => {
          if (!live) return;
          setU(s);
          setErr(false);
        })
        .catch(() => live && setErr(true));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (err && !u) return <p className="err">Couldn&apos;t read the chain right now. Try again in a minute.</p>;
  if (!u) return <p className="muted">Reading Base…</p>;
  if (!u.configured) return <p className="muted">Usage tracking starts at launch.</p>;

  const by = u.byKind ?? { trade: 0, borrow: 0, guard: 0 };
  const recent = u.recent ?? [];
  return (
    <div>
      <div className="grid-3">
        {[
          ["Txs via Stock Port", String(u.txs ?? 0)],
          ["Wallets", String(u.wallets ?? 0)],
          ["Loans and Loan Guard", String(by.borrow + by.guard)],
        ].map(([k, v]) => (
          <div key={k} className="soft stat">
            <div className="stat-k">{k}</div>
            <div className="num stat-v">{v}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
        {by.trade} basket or sweep txs · {by.borrow} Aave V4 loan txs · {by.guard} Loan Guard txs.{" "}
        {u.behind && u.behind > 1000 ? "Still catching up with the latest blocks." : `Up to date as of block ${u.scannedTo?.toLocaleString("en-US")}.`}
      </p>
      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {recent.map((t) => (
          <a key={t.hash} href={basescanTx(t.hash)} target="_blank" rel="noreferrer" className="rule" style={{ minHeight: 44, fontSize: 13 }}>
            <span>
              <span className="num">{t.wallet}</span> · {KIND[t.kind]}
            </span>
            <span className="num">{ago(t.ago)}</span>
          </a>
        ))}
        {recent.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No txs yet. Be the first.</p>}
      </div>
    </div>
  );
}
