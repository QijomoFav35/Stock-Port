import type { Metadata } from "next";
import { LOAN_GUARD } from "@/lib/loanGuard";

export const metadata: Metadata = {
  title: "What's next · Stock Port",
  description: "What we're shipping next on Stock Port: Loan Guard, buy-and-borrow in one tx, basket collateral and more.",
};

type Item = { tag: "Live" | "Next" | "Soon"; title: string; body: string };

const ITEMS: Item[] = [
  { tag: "Live", title: "Borrow against your stocks", body: "Deposit NVDAc, AAPLc, MSFTc, GOOGLc, AMZNc, METAc, TSLAc or SPCXc and borrow USDC on Aave V4 in one tx. Live health and liquidation price." },
  { tag: "Live", title: "Themed baskets and Rotate", body: "Buy Mag 7, AI Bubble, Port Elon and more from $5, and rotate between them in one tx." },
  { tag: "Live", title: "Dust Sweep", body: "Sweep small balances into tokenized stocks." },
  { tag: LOAN_GUARD ? "Live" : "Next", title: "Loan Guard", body: "A USDC reserve that pays down your Aave loan before liquidation, with a weekend shield for the Monday open. Repay-only contract, no owner, anyone can trigger it." },
  { tag: "Next", title: "Buy and borrow in one tx", body: "Spend USDC on a stock, deposit it and borrow against it, all in one batch." },
  { tag: "Next", title: "Borrow from X", body: "Ask @bankrbot to open, top up or repay your Stock Port loan from a post." },
  { tag: "Soon", title: "Best-rate routing", body: "Send each loan to whichever lender on Base has the lower rate and the deeper USDC." },
  { tag: "Soon", title: "Basket collateral", body: "Borrow against a whole basket in one position instead of one stock at a time." },
];

const TAG_STYLE: Record<Item["tag"], { background: string; color: string }> = {
  Live: { background: "#B6F569", color: "#0A0B0D" },
  Next: { background: "#0000FF", color: "#fff" },
  Soon: { background: "var(--raised)", color: "#0A0B0D" },
};

export default function NextPage() {
  return (
    <main className="wrap" style={{ paddingTop: 72, paddingBottom: 96, maxWidth: 820 }}>
      <div className="eyebrow">Roadmap</div>
      <h1 className="disp" style={{ fontSize: "clamp(40px,6vw,64px)", lineHeight: 1.04, margin: "12px 0 0" }}>
        What&apos;s <em>next.</em>
      </h1>
      <p className="muted" style={{ fontSize: 18, marginTop: 16, maxWidth: 600 }}>
        Stock Port is your port of entry to Tokenized Stocks. Here&apos;s what&apos;s live and what ships next.
      </p>
      <div style={{ display: "grid", gap: 12, marginTop: 36 }}>
        {ITEMS.map((i) => (
          <div key={i.title} className="card" style={{ padding: 22, display: "flex", gap: 16, alignItems: "flex-start" }}>
            <span style={{ ...TAG_STYLE[i.tag], fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, flex: "none", marginTop: 2 }}>{i.tag}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{i.title}</div>
              <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>
                {i.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
