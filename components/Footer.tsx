import Link from "next/link";
import Icon from "@/components/Icon";
import FeedbackBox from "@/components/FeedbackBox";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--line)", marginTop: 48 }}>
      <div
        className="wrap"
        style={{
          padding: "32px 24px 48px",
          fontSize: 13,
          color: "var(--g60)",
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span style={{ maxWidth: 720 }}>
          Not available in the US, UK or other restricted regions. Tokenized stocks track a reference price and grant no
          shareholder or voting rights in the underlying companies. Reference prices are Chainlink NAV values, not
          execution prices. Past results don&apos;t predict future ones. Not investment advice.
        </span>
        <span style={{ display: "grid", gap: 8, justifyItems: "end" }} className="foot-links">
          <span className="nowrap" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="net-base" size={16} />
            Stock Port · built on Base
          </span>
          <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/privacy">Privacy</Link>
            <FeedbackBox />
          </span>
        </span>
      </div>
    </footer>
  );
}
