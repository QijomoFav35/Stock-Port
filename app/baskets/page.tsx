import { headers } from "next/headers";
import type { ReactNode } from "react";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { BASKETS, UNIVERSE, getBasket } from "@/lib/baskets";
import { loadStockData } from "@/lib/stockData";
import BasketDesk from "@/components/BasketDesk";
import Guardrails from "@/components/Guardrails";
import GateHead from "@/components/GateHead";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Baskets · Stock Port",
  description: "Buy a themed basket of tokenized stocks from $5 in USDC, or rotate between baskets in one tx. Self-custody.",
};

export default async function BasketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  const sp = await searchParams;
  const initial = getBasket(typeof sp.basket === "string" ? sp.basket : undefined);
  const { stocks, pegBy, error } = await loadStockData();
  return (
    <main className="glowbg">
      <section className="wrap sec-page" style={{ paddingBottom: 64 }}>
        <GateHead
          page
          gate="B1 · B2"
          label="Buy and rotate"
          title={
            <>
              {BASKETS.length} baskets. <em>Rotate anytime.</em>
            </>
          }
          sub="No stocks yet? Buy a themed basket from $5 in USDC, then switch themes in one tx."
        />
        {error && <p className="err">Prices unavailable right now: {error}</p>}
        <BasketDesk
          baskets={BASKETS}
          initialId={initial.id}
          stocks={stocks}
          peg={pegBy}
          geoBlocked={geoBlocked}
          side={
          <div className="card pad">
            <div className="eyebrow">How the basket works</div>
            <div className="disp card-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="logo" style={{ width: 36, height: 36, background: "var(--blue)", color: "#fff" }}>
                <Icon name="ph-scales" size={18} />
              </span>
              <span>
                Simple rules, <em>in public.</em>
              </span>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
              {(
                [
                  ["ph-scales", "Baskets", <>
                    <span className="num">{BASKETS.length}</span> themes · <span className="num">{UNIVERSE.length}</span> stocks
                  </>],
                  ["ph-lightning", "Route", "Aerodrome direct, 0x and o1 as fallbacks"],
                  ["ph-shield-check", "Approvals", "Exact amount only"],
                ] as [IconName, string, ReactNode][]
              ).map(([icon, k, v]) => (
                <div key={k} className="rule">
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name={icon} size={18} />
                    {k}
                  </span>
                  <span style={{ fontSize: 14, textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--g80)", marginTop: 18 }}>
              <Icon name="ph-receipt" size={16} />
              Every tx carries the Stock Port Builder Code, so anyone can verify it.
            </p>
          </div>
          }
        />
        <div style={{ marginTop: 24 }}>
          <Guardrails />
        </div>
      </section>

    </main>
  );
}
