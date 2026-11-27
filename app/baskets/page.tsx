import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { BASKETS, getBasket } from "@/lib/baskets";
import { loadStockData } from "@/lib/stockData";
import BasketDesk from "@/components/BasketDesk";
import Guardrails from "@/components/Guardrails";
import GateHead from "@/components/GateHead";

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
        />
        <div style={{ marginTop: 24 }}>
          <Guardrails />
        </div>
      </section>

    </main>
  );
}
