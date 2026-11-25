import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import DustCard from "@/components/DustCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dust Sweep · Stock Port",
  description: "Sweep the dust in your wallet into tokenized stocks on Base. Exact approvals, self-custody.",
};

export default async function DustPage() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  return (
    <main className="glowbg">
      <header className="wrap" style={{ textAlign: "center", paddingTop: 72, paddingBottom: 40 }}>
        <span className="tag r1" style={{ background: "var(--yellow)", color: "var(--ink)" }}>
          Dust sweep
        </span>
        <h1 className="disp r2" style={{ fontSize: "clamp(40px,6.4vw,76px)", lineHeight: 1.02, margin: "20px 0 0" }}>
          Sweep your dust <em>into stocks.</em>
        </h1>
        <p className="muted r3" style={{ maxWidth: 600, margin: "20px auto 0", fontSize: 18 }}>
          Swap the dust in your wallet to USDC, then buy the Agent&apos;s tokenized stock basket. Every tx is shown before
          you sign.
        </p>
      </header>
      <section className="wrap" style={{ paddingBottom: 48 }}>
        <DustCard geoBlocked={geoBlocked} />
      </section>
    </main>
  );
}
