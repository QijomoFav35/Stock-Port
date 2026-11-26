import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import BorrowCard from "@/components/BorrowCard";
import GuardCard from "@/components/GuardCard";
import GuardAgent from "@/components/GuardAgent";
import GateHead from "@/components/GateHead";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Borrow · Stock Port",
  description: "Borrow USDC against your tokenized stocks on Aave V4, with Loan Guard repaying before liquidation. Self-custody.",
};

export default async function BorrowPage() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  return (
    <main className="glowbg">
      <section className="wrap sec-page">
        <GateHead
          page
          gate="A1"
          label="Borrow"
          title={
            <>
              Borrow against your stocks. <em>Never sell.</em>
            </>
          }
          sub="USDC from Aave V4 on Base against 8 tokenized stocks. Your tokenized stocks stay as collateral, and you repay whenever you want."
        />
        <div className="sec-narrow">
          <BorrowCard geoBlocked={geoBlocked} />
        </div>
      </section>

      <section id="guard" className="wrap sec" style={{ paddingBottom: 64 }}>
        <GateHead
          gate="A2"
          label="Loan Guard"
          title={
            <>
              An agent that <em>watches your loan.</em>
            </>
          }
          sub="Stocks can dump while you sleep, and NAV goes stale when TradFi closes for the weekend. The Guard Agent reads live pool prices to see the Monday open coming, and Loan Guard repays from your own USDC reserve before Aave can liquidate you."
        />
        <div className="sec-narrow">
          <GuardCard />
        </div>
        <div style={{ marginTop: 24 }}>
          <GuardAgent />
        </div>
      </section>
    </main>
  );
}
