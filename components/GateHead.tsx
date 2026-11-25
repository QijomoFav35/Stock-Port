import type { ReactNode } from "react";

/** Section header that matches a row on the departures board: gate tag, title, one line of context. */
export default function GateHead({ gate, label, title, sub }: { gate: string; label: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="gate-head">
      <div className="gate-tag">
        <span className="num gate-code">{gate}</span>
        <span>{label}</span>
      </div>
      <h2 className="disp gate-title">{title}</h2>
      {sub && <p className="gate-sub">{sub}</p>}
    </div>
  );
}
