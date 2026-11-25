import { PEG_LABEL, PEG_STYLE, spreadText, type PegHealth } from "@/lib/peg";

const usd = (n: number) => "$" + n.toFixed(2);

/** "+0.3% vs NAV · Healthy". Pool price vs the Chainlink reference, from lib/pegHealth.ts. */
export default function PegChip({ peg, compact = false }: { peg?: PegHealth; compact?: boolean }) {
  const status = peg?.status ?? "unknown";
  const spread = spreadText(peg);
  const title =
    peg?.poolPrice && peg.refPrice ? `Pool ${usd(peg.poolPrice)} vs NAV ${usd(peg.refPrice)}` : "Pool price vs NAV unavailable";
  return (
    <span
      title={title}
      style={{
        ...PEG_STYLE[status],
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "2px 8px" : "3px 10px",
        borderRadius: 999,
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {spread && <span className="num">{spread}</span>}
      {spread && <span aria-hidden="true">·</span>}
      {PEG_LABEL[status]}
    </span>
  );
}
