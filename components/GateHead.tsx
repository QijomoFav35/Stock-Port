import type { ReactNode } from "react";

/**
 * Header that matches a row on the routes board: route code, label, title, one line of context.
 * `page` renders the title as the page's h1 (feature pages); otherwise it is a section h2.
 */
export default function GateHead({
  gate,
  label,
  title,
  sub,
  page = false,
}: {
  gate: string;
  label: string;
  title: ReactNode;
  sub?: ReactNode;
  page?: boolean;
}) {
  const Title = page ? "h1" : "h2";
  return (
    <div className={`gate-head${page ? " gate-head-page" : ""}`}>
      <div className="gate-tag">
        <span className="num gate-code">{gate}</span>
        <span>{label}</span>
      </div>
      <Title className="disp gate-title">{title}</Title>
      {sub && <p className="gate-sub">{sub}</p>}
    </div>
  );
}
