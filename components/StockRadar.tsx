import { isNavStale, type TokenizedStock } from "@/lib/tokenizedStocks";
import type { PegHealth } from "@/lib/peg";
import PegChip from "@/components/PegChip";

const usd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Every tokenized stock listed on Base, basket first. Peg health only for basket legs (it costs RPC reads). */
export default function StockRadar({ all, basket, peg }: { all: TokenizedStock[]; basket: string[]; peg: PegHealth[] }) {
  const inBasket = new Set(basket.map((s) => s.toLowerCase()));
  const rows = [...all].sort((a, b) => {
    const d = Number(inBasket.has(b.symbol.toLowerCase())) - Number(inBasket.has(a.symbol.toLowerCase()));
    return d || a.symbol.localeCompare(b.symbol);
  });
  const pegBy = new Map(peg.map((p) => [p.symbol.toLowerCase(), p]));
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "28px 28px 18px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
        <div>
          <div className="eyebrow">Stock radar</div>
          <div className="disp" style={{ fontSize: 28, marginTop: 6 }}>
            Every tokenized stock <em>on Base.</em>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--g60)", maxWidth: 360 }}>
          {all.length} listed, live from the Coinbase Tokenized Stocks API. The Agent holds the ones on top.
        </div>
      </div>
      <div style={{ maxHeight: 440, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
        {rows.map((t) => {
          const held = inBasket.has(t.symbol.toLowerCase());
          const stale = isNavStale(t);
          return (
            <div
              key={t.contract_address}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 28px",
                borderBottom: "1px solid var(--line)",
                background: held ? "rgba(0,0,255,.04)" : undefined,
              }}
            >
              <span className="logo" style={{ width: 32, height: 32, flex: "none" }}>
                {t.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.icon_url} alt="" loading="lazy" />
                ) : (
                  <span className="num" style={{ fontSize: 11 }}>
                    {t.symbol.slice(0, 2)}
                  </span>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                  {t.symbol}
                  {held && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--blue)", color: "#fff" }}>
                      In basket
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--g60)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div className="num" style={{ fontWeight: 600 }}>
                  {t.nav_price ? usd(t.nav_price) : "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--g60)", marginTop: 2 }}>
                  {held ? <PegChip peg={pegBy.get(t.symbol.toLowerCase())} compact /> : t.nav_price ? (stale ? "NAV · stale" : "NAV") : "no NAV"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
