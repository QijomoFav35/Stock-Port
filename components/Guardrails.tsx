import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";
import { DRIFT_GUARD_ON, NAV_DRIFT_MAX_PCT } from "@/lib/peg";

/** Only rules the code enforces today are "Live". Agent rules stay "Soon" until the Agent ships. */
const RULES: { icon: IconName; title: string; body: string; live: boolean }[] = [
  { icon: "ph-wallet", title: "Self-custody", body: "Tokens land in your wallet. Stock Port never holds your funds.", live: true },
  { icon: "ph-shield-check", title: "Exact approvals", body: "You approve exactly what you spend. No infinite approval.", live: true },
  {
    icon: "ph-scales",
    title: `${NAV_DRIFT_MAX_PCT}% NAV drift guard`,
    body: `Buys pause when a pool trades more than ${NAV_DRIFT_MAX_PCT}% away from its Chainlink NAV.`,
    live: DRIFT_GUARD_ON,
  },
  { icon: "ph-eye", title: "Verified contracts only", body: "Every call is checked against an allowlist before your wallet opens.", live: true },
  { icon: "ph-clock", title: "Rebalance cap", body: "The Agent moves at most 25% of the basket per day.", live: false },
  { icon: "ph-receipt", title: "Split and dividend aware", body: "Holdings read with B20 scaledBalanceOf, so splits don't skew your balance.", live: false },
];

export default function Guardrails() {
  return (
    <div className="card pad">
      <div className="eyebrow">Agent guardrails</div>
      <div className="disp card-title">
        Hard rules, <em>enforced in code.</em>
      </div>
      <div style={{ display: "grid", gap: 14, columnGap: 32, marginTop: 24, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
        {RULES.map((r) => (
          <div key={r.title} style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: r.live ? 1 : 0.7 }}>
            <span style={{ color: r.live ? "var(--blue)" : "var(--g60)", marginTop: 2 }}>
              <Icon name={r.icon} size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                {r.title}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: r.live ? "#B6F569" : "var(--raised)",
                    color: r.live ? "var(--ink)" : "var(--g60)",
                  }}
                >
                  {r.live ? "Live" : "Soon"}
                </span>
              </div>
              <div style={{ fontSize: 14, color: "var(--g60)", marginTop: 2 }}>{r.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
