/**
 * Departures-board style menu: every gate is one thing you can do at Stock Port. Each row opens that feature's page.
 * Terminal A = loans (borrow, guard), B = buy collateral, C = public proof.
 */
import Link from "next/link";
import { LOAN_GUARD } from "@/lib/loanGuard";

type Status = "Boarding" | "Open" | "Next";
type Gate = { gate: string; action: string; what: string; status: Status; href: string };

const GATES: Gate[] = [
  { gate: "A1", action: "BORROW", what: "USDC against your stocks. Never sell.", status: "Boarding", href: "/borrow" },
  { gate: "A2", action: "LOAN GUARD", what: "An agent that repays before liquidation", status: LOAN_GUARD ? "Open" : "Next", href: "/borrow#guard" },
  { gate: "B1", action: "BUY", what: "Tokenized stocks from $5 to borrow against", status: "Open", href: "/baskets" },
  { gate: "C1", action: "STATS", what: "Every tx, verifiable onchain", status: "Open", href: "/stats" },
];

const STATUS: Record<Status, { background: string; color: string }> = {
  Boarding: { background: "#B6F569", color: "#0A0B0D" },
  Open: { background: "rgba(255,255,255,.14)", color: "#fff" },
  Next: { background: "#FFD12F", color: "#0A0B0D" },
};

export default function GatesBoard() {
  return (
    <nav className="board" aria-label="Stock Port routes">
      <div className="board-head" aria-hidden="true">
        <span>Route</span>
        <span>Departure</span>
        <span className="board-what">Destination</span>
        <span style={{ textAlign: "right" }}>Status</span>
      </div>
      {GATES.map((g) => (
        <Link key={g.gate} href={g.href} className="board-row" aria-label={`Route ${g.gate}, ${g.action.toLowerCase()}: ${g.what}. ${g.status}.`}>
          <span className="num board-gate" aria-hidden="true">
            {g.gate}
          </span>
          <span className="num board-flap" aria-hidden="true">
            {g.action.split("").map((c, i) => (
              <span key={i} className="flap" style={{ animationDelay: `${i * 40}ms` }}>
                {c === " " ? " " : c}
              </span>
            ))}
          </span>
          <span className="board-what" aria-hidden="true">
            {g.what}
          </span>
          <span style={{ textAlign: "right" }} aria-hidden="true">
            <span className="board-status" style={STATUS[g.status]}>
              {g.status}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
