"use client";
import { useEffect, useState } from "react";
import PortCard from "@/components/PortCard";
import RotateCard from "@/components/RotateCard";
import PegChip from "@/components/PegChip";
import type { Basket } from "@/lib/baskets";
import type { PegHealth } from "@/lib/peg";

export type StockInfo = { symbol: string; name: string; icon?: string; nav?: number; address?: string; decimals?: number };

const LEG_COLORS = ["#0000FF", "#3C8AFF", "#FEA8CD", "#FFD12F", "#B6F569", "#66C800", "#FC401F"];
const usd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Logo({ s, size = 40 }: { s?: StockInfo; size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size, flex: "none" }}>
      {s?.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.icon} alt="" />
      ) : (
        <span className="num" style={{ fontSize: size * 0.32 }}>
          {s?.symbol.slice(0, 2) ?? "?"}
        </span>
      )}
    </span>
  );
}

/** Pick a themed basket, see what's in it (with peg health), and buy it. */
export default function BasketDesk({
  baskets,
  initialId,
  stocks,
  peg,
  geoBlocked,
}: {
  baskets: Basket[];
  initialId: string;
  stocks: Record<string, StockInfo>;
  peg: Record<string, PegHealth>;
  geoBlocked: boolean;
}) {
  const [id, setId] = useState(initialId);
  const [mode, setMode] = useState<"buy" | "rotate">("buy");
  // The Rotate route on the home board links here with ?mode=rotate.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "rotate") setMode("rotate");
  }, []);
  const basket = baskets.find((b) => b.id === id) ?? baskets[0];
  const pick = (next: string) => {
    setId(next);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("basket", next);
      window.history.replaceState(null, "", u);
    } catch {}
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div role="tablist" aria-label="Baskets" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {baskets.map((b) => {
          const on = b.id === basket.id;
          return (
            <button
              key={b.id}
              role="tab"
              aria-selected={on}
              onClick={() => pick(b.id)}
              className="btn btn-sm"
              style={{
                background: on ? b.color : "#fff",
                color: on ? b.ink : "var(--ink)",
                border: on ? `1px solid ${b.color}` : "1px solid var(--line-hi)",
                boxShadow: "none",
              }}
            >
              {b.name}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div className="card pad">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: basket.color, flex: "none" }} />
            <div className="eyebrow">Basket · {basket.legs.length} stocks</div>
          </div>
          <div className="disp" style={{ fontSize: 34, marginTop: 10 }}>
            {basket.name}
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: 15 }}>
            {basket.thesis}
          </p>

          <div style={{ display: "grid", gap: 14, marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            {basket.legs.map((l) => {
              const s = stocks[l.symbol];
              return (
                <div key={l.symbol} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Logo s={s ?? { symbol: l.symbol, name: l.symbol }} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600 }}>
                      <span>{l.symbol}</span>
                      <span className="num">{s?.nav ? usd(s.nav) : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "var(--g60)", alignItems: "center" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(l.weightBps / 100).toFixed(l.weightBps % 100 ? 1 : 0)}% · {s?.name ?? ""}
                      </span>
                      <PegChip peg={peg[l.symbol]} compact />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div aria-hidden="true" style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 20, gap: 3 }}>
            {basket.legs.map((l, i) => (
              <span key={l.symbol} style={{ flex: l.weightBps, background: LEG_COLORS[i % LEG_COLORS.length] }} />
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div role="tablist" aria-label="Buy or rotate" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 999, background: "var(--raised)" }}>
            {(["buy", "rotate"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 999,
                  border: 0,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 15,
                  background: mode === m ? "#fff" : "transparent",
                  color: mode === m ? "var(--ink)" : "var(--g60)",
                  boxShadow: mode === m ? "0 1px 2px rgba(10,11,13,.08)" : "none",
                }}
              >
                {m === "buy" ? "Buy with USDC" : "Rotate"}
              </button>
            ))}
          </div>
          {mode === "buy" ? (
            <PortCard key={basket.id} geoBlocked={geoBlocked} basket={{ id: basket.id, name: basket.name }} />
          ) : (
            <RotateCard key={basket.id} baskets={baskets} to={basket} stocks={stocks} geoBlocked={geoBlocked} />
          )}
        </div>
      </div>
    </div>
  );
}
