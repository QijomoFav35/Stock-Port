import { KNOWN_CONTRACTS, basescanAddress } from "@/lib/txGuard";
import Icon from "@/components/Icon";

const REPO = "https://github.com/QijomoFav35/Stock-Port";

/** Short answer to "can this app drain my wallet?" Shown on the buy card. */
export default function SafetyNote() {
  return (
    <details style={{ marginTop: 16, fontSize: 13, color: "var(--g60)" }}>
      <summary style={{ cursor: "pointer", display: "flex", gap: 6, alignItems: "center", justifyContent: "center", listStyle: "none" }}>
        <span style={{ color: "var(--green)" }}>
          <Icon name="ph-shield-check" size={16} />
        </span>
        Exact approval, no infinite approvals · <span style={{ color: "var(--blue)" }}>why it&apos;s safe</span>
      </summary>
      <ul style={{ marginTop: 12, paddingLeft: 20, display: "grid", gap: 6, textAlign: "left" }}>
        <li>Non-custodial. Buys land in your own wallet; no Stock Port server ever holds funds.</li>
        <li>Exact approvals only, never infinite. A $20 buy can move $20 of USDC and nothing more.</li>
        <li>
          Routed by{" "}
          <a href="https://o1.exchange" target="_blank" rel="noreferrer">
            o1 Exchange
          </a>{" "}
          via the{" "}
          <a href={basescanAddress(KNOWN_CONTRACTS.zeroExAllowanceHolder.address)} target="_blank" rel="noreferrer">
            AllowanceHolder contract
          </a>
          , or the official{" "}
          <a href={basescanAddress(KNOWN_CONTRACTS.aerodromeRouter.address)} target="_blank" rel="noreferrer">
            Aerodrome router
          </a>
          . The app refuses to send to any other contract.
        </li>
        <li>You review every step before your wallet opens. Nothing moves until you sign.</li>
        <li>
          Check or revoke approvals anytime at{" "}
          <a href="https://revoke.cash" target="_blank" rel="noreferrer">
            revoke.cash
          </a>
          .
        </li>
        <li>
          Open source:{" "}
          <a href={REPO} target="_blank" rel="noreferrer">
            read the code
          </a>
          . Don&apos;t trust, verify.
        </li>
      </ul>
    </details>
  );
}
