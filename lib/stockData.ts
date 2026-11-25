/** Server-side loaders shared by the pages that show tokenized stock data. */
import { UNIVERSE } from "@/lib/baskets";
import { listTokenizedStocks, type TokenizedStock } from "@/lib/tokenizedStocks";
import { getPegHealth } from "@/lib/pegHealth";
import type { PegHealth } from "@/lib/peg";
import type { StockInfo } from "@/components/BasketDesk";

export type StockData = {
  all: TokenizedStock[];
  peg: PegHealth[];
  /** Basket universe keyed by symbol, for the basket desk. */
  stocks: Record<string, StockInfo>;
  pegBy: Record<string, PegHealth>;
  error?: string;
};

/** Coinbase tokenized stock list plus (optionally) onchain peg health for the basket universe. */
export async function loadStockData({ withPeg = true }: { withPeg?: boolean } = {}): Promise<StockData> {
  let all: TokenizedStock[] = [];
  let peg: PegHealth[] = [];
  let error: string | undefined;
  try {
    all = await listTokenizedStocks();
    if (withPeg) {
      const universe = all.filter((t) => (UNIVERSE as readonly string[]).includes(t.symbol));
      peg = await getPegHealth(universe);
    }
  } catch (e) {
    error = (e as Error).message;
  }
  const bySymbol = new Map(all.map((t) => [t.symbol, t]));
  const stocks: Record<string, StockInfo> = {};
  for (const sym of UNIVERSE) {
    const t = bySymbol.get(sym);
    if (t) stocks[sym] = { symbol: sym, name: t.name, icon: t.icon_url, nav: t.nav_price, address: t.contract_address, decimals: t.decimals };
  }
  return { all, peg, stocks, pegBy: Object.fromEntries(peg.map((p) => [p.symbol, p])), error };
}
