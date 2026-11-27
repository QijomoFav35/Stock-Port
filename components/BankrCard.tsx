"use client";
import { useState } from "react";

const EXAMPLES = [
  "@bankrbot borrow 10 USDC against 0.05 NVDAc on Stock Port",
  "@bankrbot add 0.02 METAc to my Stock Port loan",
  "@bankrbot how is my Stock Port loan",
  "@bankrbot repay my Stock Port loan",
];

/** Borrow from X: how to use Stock Port loans through Bankr. */
export default function BankrCard({ site }: { site: string }) {
  const [copied, setCopied] = useState<string>();
  const skill = `${site.replace(/\/$/, "")}/bankr/skill.md`;
  const copy = (t: string) =>
    navigator.clipboard?.writeText(t).then(
      () => {
        setCopied(t);
        setTimeout(() => setCopied(undefined), 1500);
      },
      () => undefined,
    );

  return (
    <section className="card pad">
      <div className="eyebrow">Borrow from X</div>
      <div className="disp card-title">
        Post it. <em>Bankr signs it.</em>
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
        Open, top up, check or repay your Stock Port loan from a post. Stock Port builds the exact Aave txs, and your own Bankr wallet sends them. Same rules
        as here: exact approvals, and no new loan under health 1.3.
      </p>

      <ol style={{ display: "grid", gap: 10, marginTop: 16, paddingLeft: 20, fontSize: 14 }}>
        <li>
          Add the Stock Port skill to your Bankr agent:{" "}
          <button className="linkish" onClick={() => copy(skill)}>
            {copied === skill ? "Copied" : "copy skill link"}
          </button>{" "}
          ·{" "}
          <a href={skill} target="_blank" rel="noreferrer">
            view it
          </a>
        </li>
        <li>In Bankr security settings, turn on arbitrary contract calls (it asks for MFA).</li>
        <li>Hold the stock or USDC in your Bankr wallet on Base. X replies need Bankr Club.</li>
      </ol>

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => copy(e)}
            className="soft"
            style={{ textAlign: "left", padding: "12px 14px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 14, color: "var(--ink)" }}
          >
            {copied === e ? "Copied" : e}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--g60)", marginTop: 14 }}>
        Bankr is a separate service with its own limits. Not available in the US, UK or other restricted regions.
      </p>
    </section>
  );
}
