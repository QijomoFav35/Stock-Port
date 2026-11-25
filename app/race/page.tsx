import { UNIVERSE } from "@/lib/baskets";
import { loadStockData } from "@/lib/stockData";
import LeaderboardCard from "@/components/LeaderboardCard";
import StockRadar from "@/components/StockRadar";
import GateHead from "@/components/GateHead";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Basket race · Stock Port",
  description: "Which tokenized stock basket is winning, ranked by Chainlink NAV onchain. Plus every tokenized stock with a live NAV on Base.",
};

export default async function RacePage() {
  const { all, peg } = await loadStockData();
  return (
    <main className="glowbg">
      <section className="wrap sec-page" style={{ paddingBottom: 64 }}>
        <GateHead
          page
          gate="B4"
          label="Basket race"
          title={
            <>
              Which basket is <em>winning this week.</em>
            </>
          }
          sub="Every basket ranked by its Chainlink NAV, read onchain."
        />
        <LeaderboardCard />
        {all.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <StockRadar all={all} basket={[...UNIVERSE]} peg={peg} />
          </div>
        )}
      </section>
    </main>
  );
}
