import GateHead from "@/components/GateHead";
import UsageBoard from "@/components/UsageBoard";
import GuardLog from "@/components/GuardLog";

export const metadata = {
  title: "Port traffic · Stock Port",
  description: "Every Stock Port tx on Base, found onchain by its Builder Code. Live counts of baskets, Aave V4 loans and Loan Guard top-ups.",
};

export default function StatsPage() {
  return (
    <main className="glowbg">
      <section className="wrap sec-page" style={{ paddingBottom: 64, maxWidth: 880 }}>
        <GateHead
          page
          gate="LOG"
          label="Port traffic"
          title={
            <>
              Every tx, <em>onchain and verifiable.</em>
            </>
          }
          sub="We count only txs on Base that carry the Stock Port Builder Code. Nothing self-reported: every row links to Basescan."
        />
        <div className="card pad">
          <div className="eyebrow">All routes</div>
          <div style={{ marginTop: 14 }}>
            <UsageBoard />
          </div>
        </div>
        <div className="card pad" style={{ marginTop: 16 }}>
          <div className="eyebrow">Guard Agent log</div>
          <GuardLog />
        </div>
      </section>
    </main>
  );
}
