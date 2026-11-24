import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { parseBasket } from "@/lib/constants";
import { isNavStale, resolveSymbols, type TokenizedStock } from "@/lib/tokenizedStocks";
import PortCard from "@/components/PortCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  const basket = parseBasket();
  let tokens: TokenizedStock[] = [];
  let basketError: string | undefined;
  try {
    tokens = await resolveSymbols(basket.map((b) => b.symbol));
  } catch (e) {
    basketError = (e as Error).message;
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Stock Port</h1>
        <p className="text-sm text-neutral-500">
          Mirror the Port Agent&apos;s tokenized stock basket on Base in one tap.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
        <h2 className="font-semibold">Agent basket</h2>
        {basketError && <p className="text-sm text-red-600">Basket unavailable: {basketError}</p>}
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {tokens.map((t, i) => (
            <li key={t.contract_address} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                {t.icon_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.icon_url} alt="" className="h-7 w-7 rounded-full" />
                )}
                <div>
                  <div className="font-medium">{t.symbol}</div>
                  <div className="text-xs text-neutral-500">{t.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{(basket[i].weightBps / 100).toFixed(0)}%</div>
                <div className="text-xs text-neutral-500">
                  {t.nav_price ? `ref $${t.nav_price.toFixed(2)}` : "no ref price"}
                  {t.nav_price && isNavStale(t) ? " (stale)" : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <PortCard geoBlocked={geoBlocked} />

      <footer className="text-xs text-neutral-500 space-y-2">
        <p>
          Tokenized stocks are not available to persons in the United States or in restricted jurisdictions.
          Tokens track a reference value and do not grant shareholder rights, including voting rights, in the
          underlying company. Reference prices are Chainlink NAV values, not execution prices. Nothing here is
          investment advice or an offer to buy or sell securities.
        </p>
      </footer>
    </main>
  );
}
