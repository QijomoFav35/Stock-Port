"use client";
import { useEffect, useState } from "react";
import type { Leaderboard } from "@/lib/leaderboard";

const pct = (x: number) => (x > 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
const chip = (x: number) => ({
  background: x > 0 ? "#B6F569" : x < 0 ? "rgba(252,64,31,.12)" : "var(--raised)",
  color: x < 0 ? "#FC401F" : "var(--ink)",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
});

/** Basket race: 7d and 24h moves from onchain NAV history. Tapping a row opens that basket. */
export default function LeaderboardCard() {
  const [lb, setLb] = useState<Leaderboard>();
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setLb)
      .catch(() => setErr(true));
  }, []);

  return (
    <div className="card pad" style={{ padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">Basket race</div>
          <div className="disp" style={{ fontSize: 30, marginTop: 8 }}>
            Who&apos;s <em>winning</em> this week
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--g60)" }}>From Chainlink NAV, onchain. Past results don&apos;t predict future ones.</div>
      </div>

      {!lb && !err && <p className="muted" style={{ marginTop: 20 }}>Reading NAV history from Base…</p>}
      {err && <p className="muted" style={{ marginTop: 20 }}>Couldn&apos;t load the race right now.</p>}

      {lb && (
        <div style={{ marginTop: 18 }}>
          <div className="rule" style={{ fontSize: 12, color: "var(--g60)", border: 0, paddingBottom: 0 }}>
            <span>#  Basket</span>
            <span style={{ display: "flex", gap: 28 }}>
              <span>24h</span>
              <span>7d</span>
            </span>
          </div>
          {lb.baskets.map((b, i) => (
            <a
              key={b.id}
              href={`/?basket=${b.id}#buy`}
              className="rule"
              style={{ textDecoration: "none", color: "var(--ink)", alignItems: "center" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
                <span className="num" style={{ width: 18, color: "var(--g60)" }}>
                  {i + 1}
                </span>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: b.color, border: "1px solid var(--line-hi)" }} />
                {b.name}
                {i === 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--blue)", color: "#fff" }}>Leader</span>}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <span className="num" style={chip(b.d1)}>
                  {pct(b.d1)}
                </span>
                <span className="num" style={chip(b.d7)}>
                  {pct(b.d7)}
                </span>
              </span>
            </a>
          ))}
          {lb.stocks.length > 0 && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--g60)", marginTop: 14 }}>
              <span>
                Top 24h: <b style={{ color: "var(--ink)" }}>{lb.stocks[0].symbol}</b> {pct(lb.stocks[0].d1)}
              </span>
              <span>
                Worst 24h: <b style={{ color: "var(--ink)" }}>{lb.stocks[lb.stocks.length - 1].symbol}</b> {pct(lb.stocks[lb.stocks.length - 1].d1)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
