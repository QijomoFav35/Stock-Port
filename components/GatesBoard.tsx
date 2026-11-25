/** Departures-board style menu: every gate is one thing you can do at Stock Port. Rows jump to that section. */
type Gate = { gate: string; action: string; what: string; status: "Boarding" | "Open" | "Next"; href: string };

const GATES: Gate[] = [
  { gate: "A1", action: "BORROW", what: "USDC against your stocks. Never sell.", status: "Boarding", href: "#borrow" },
  { gate: "A2", action: "BUY", what: "Themed baskets from $5 in one tx", status: "Open", href: "#buy" },
  { gate: "A3", action: "ROTATE", what: "Switch baskets in one tx", status: "Open", href: "/?mode=rotate#buy" },
  { gate: "A4", action: "SWEEP", what: "Turn wallet dust into stocks", status: "Open", href: "/dust" },
  { gate: "A5", action: "RACE", what: "Which basket is winning this week", status: "Open", href: "#race" },
  { gate: "B1", action: "LOAN GUARD", what: "Never get liquidated in your sleep", status: "Next", href: "#guard" },
];

const STATUS: Record<Gate["status"], { background: string; color: string }> = {
  Boarding: { background: "#B6F569", color: "#0A0B0D" },
  Open: { background: "rgba(255,255,255,.14)", color: "#fff" },
  Next: { background: "#FFD12F", color: "#0A0B0D" },
};

export default function GatesBoard() {
  return (
    <div className="board" role="navigation" aria-label="Stock Port gates">
      <div className="board-head">
        <span>Gate</span>
        <span>Departure</span>
        <span className="board-what">Destination</span>
        <span style={{ textAlign: "right" }}>Status</span>
      </div>
      {GATES.map((g) => (
        <a key={g.gate} href={g.href} className="board-row">
          <span className="num board-gate">{g.gate}</span>
          <span className="num board-flap">
            {g.action.split("").map((c, i) => (
              <span key={i} className="flap" style={{ animationDelay: `${i * 40}ms` }}>
                {c === " " ? " " : c}
              </span>
            ))}
          </span>
          <span className="board-what">{g.what}</span>
          <span style={{ textAlign: "right" }}>
            <span className="board-status" style={STATUS[g.status]}>
              {g.status}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}
