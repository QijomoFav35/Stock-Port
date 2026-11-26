import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import DustCard from "@/components/DustCard";
import GateHead from "@/components/GateHead";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dust Sweep · Stock Port",
  description: "Sweep the dust in your wallet into tokenized stocks on Base. Exact approvals, self-custody.",
};

export default async function SweepPage() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  return (
    <main className="glowbg">
      <section className="wrap sec-page" style={{ paddingBottom: 64 }}>
        <GateHead
          page
          gate="B3"
          label="Dust Sweep"
          title={
            <>
              Sweep dust tokens <em>into stocks.</em>
            </>
          }
          sub="Swap the dust in your wallet to USDC, then buy a tokenized stock basket. Spam is hidden, and anything not worth the Gas is skipped. Every tx is shown before you sign."
        />
        <DustCard geoBlocked={geoBlocked} />
      </section>
    </main>
  );
}
