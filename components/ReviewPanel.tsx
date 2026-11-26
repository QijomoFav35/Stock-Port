"use client";
import type { PortPlan } from "@/hooks/usePortBundle";
import { basescanAddress } from "@/lib/txGuard";
import Icon from "@/components/Icon";
import PegChip from "@/components/PegChip";

const fmtUsd = (s: string) => `$${Number(s).toFixed(2)}`;
const fmtQty = (s: string) => Number(s).toLocaleString("en-US", { maximumSignificantDigits: 4 });
const ROUTE: Record<PortPlan["provider"], string> = { aerodrome: "Aerodrome", "0x": "0x", o1: "o1 Exchange" };

function Dot({ n }: { n: number }) {
  return (
    <span
      className="num"
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        border: "1px solid var(--line-hi)",
      }}
    >
      {n}
    </span>
  );
}

/** Exactly what the wallet will be asked to sign, before it opens. */
export default function ReviewPanel({ plan, onConfirm, onCancel }: { plan: PortPlan; onConfirm: () => void; onCancel: () => void }) {
  let n = 0;
  return (
    <div className="soft" style={{ padding: 20, borderRadius: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 20 }}>Review tx</div>
        <button
          onClick={onCancel}
          aria-label="Cancel"
          style={{ width: 36, height: 36, borderRadius: 18, border: 0, background: "#fff", cursor: "pointer", color: "var(--g60)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="ph-x" size={16} />
        </button>
      </div>
      <div className="num" style={{ fontSize: 40, textAlign: "center", marginTop: 12 }}>
        {fmtUsd(plan.totalUsdc)}
      </div>
      <div style={{ textAlign: "center", fontSize: 14, color: "var(--g60)", display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
        <Icon name="tok-usdc" size={16} /> USDC into the basket via {ROUTE[plan.provider]}
      </div>

      <div style={{ marginTop: 16, fontWeight: 600 }}>You&apos;ll sign</div>
      <div>
        {plan.approval && (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderTop: "1px solid var(--line)" }}>
            <Dot n={++n} />
            <div>
              <div>Approve exactly {fmtUsd(plan.approval.usdc)} USDC</div>
              <div style={{ fontSize: 13, color: "var(--g60)" }}>
                Spender:{" "}
                <a href={basescanAddress(plan.approval.spender)} target="_blank" rel="noreferrer">
                  {plan.approval.spenderName}
                </a>
                . No infinite approval.
              </div>
            </div>
          </div>
        )}
        {plan.buys.map((b) => (
          <div key={b.token} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderTop: "1px solid var(--line)" }}>
            <Dot n={++n} />
            <div style={{ flex: 1, display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  Buy {b.symbol} <PegChip peg={b.peg} compact />
                </div>
                {b.minOut && (
                  <div style={{ fontSize: 13, color: "var(--g60)" }}>
                    Min out {fmtQty(b.minOut)} {b.symbol}, or the tx reverts
                  </div>
                )}
              </div>
              <span className="num" style={{ fontWeight: 600 }}>
                {fmtUsd(b.usdc)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, color: "var(--g60)", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
        Contracts:{" "}
        {plan.contracts.map((c, i) => (
          <span key={c.address}>
            {i > 0 && ", "}
            <a href={basescanAddress(c.address)} target="_blank" rel="noreferrer">
              {c.name}
            </a>
          </span>
        ))}
        . Your wallet shows {plan.steps === 1 ? "1 step" : `${plan.steps} steps, or one batched prompt if it supports it`}.
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "12px 14px",
          borderRadius: 14,
          background: "rgba(182,245,105,.25)",
          border: "1px solid rgba(102,200,0,.35)",
          fontSize: 13,
          color: "var(--g80)",
        }}
      >
        <span style={{ color: "var(--green)" }}>
          <Icon name="ph-shield-check" size={18} />
        </span>
        Verified contracts only, exact amounts, tokens go to you.
      </div>
      <button onClick={onConfirm} className="btn btn-blue" style={{ width: "100%", marginTop: 16 }}>
        Confirm in wallet
      </button>
    </div>
  );
}
