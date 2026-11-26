"use client";
import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import ConnectButton from "@/components/ConnectButton";
import GuardLog from "@/components/GuardLog";
import { useLoanGuard, type GuardState } from "@/hooks/useLoanGuard";
import { GUARD_PREVIEW, LOAN_GUARD } from "@/lib/loanGuard";
import { basescanAddress } from "@/lib/txGuard";

const usd = (raw: bigint) => "$" + Number(formatUnits(raw, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : NaN);
/** How far collateral can fall before liquidation at a given health factor (debt held constant). */
const cushion = (hf: number) => Math.round((1 - 1 / hf) * 100);

type Preset = { id: string; name: string; trigger: number; target: number; weekend: number };
const PRESETS: Preset[] = [
  { id: "relaxed", name: "Relaxed", trigger: 1.1, target: 1.25, weekend: 1.2 },
  { id: "balanced", name: "Balanced", trigger: 1.15, target: 1.4, weekend: 1.3 },
  { id: "tight", name: "Tight", trigger: 1.25, target: 1.6, weekend: 1.45 },
];
const presetFor = (t: number, tg: number, w: number) => PRESETS.find((p) => p.trigger === t && p.target === tg && p.weekend === w)?.id;

const SAMPLE: GuardState = {
  reserve: 250_000_000n,
  trigger: 1.15,
  target: 1.4,
  weekendTrigger: 1.3,
  lastProtect: 1795359600, // fixed so server and client render the same sample
  giverApproved: true,
  needed: false,
  health: 1.62,
};

/** Route A2: Loan Guard. A USDC reserve that repays your Aave loan before liquidation. */
export default function GuardCard() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const live = useLoanGuard(walletClient, address);
  const [previewNote, setPreviewNote] = useState(false);
  // Dates are formatted in the viewer's locale and time zone, so render them only after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Preview mode: same shape as the live hook, sample state, and buttons that only show a note.
  const g: typeof live = GUARD_PREVIEW
    ? {
        ...live,
        deployed: true,
        builderCodeConfigured: true,
        state: SAMPLE,
        arm: async () => setPreviewNote(true),
        withdrawReserve: async () => setPreviewNote(true),
      }
    : live;
  const [preset, setPreset] = useState<string | undefined>("balanced");
  const [advanced, setAdvanced] = useState(false);
  const [trigger, setTrigger] = useState("1.15");
  const [target, setTarget] = useState("1.40");
  const [weekend, setWeekend] = useState("1.30");
  const [fund, setFund] = useState("");
  const busy = g.status === "confirming" || g.status === "pending";

  useEffect(() => {
    const s = g.state;
    if (s && s.trigger > 0) {
      setTrigger(s.trigger.toFixed(2));
      setTarget(s.target.toFixed(2));
      setWeekend(s.weekendTrigger ? s.weekendTrigger.toFixed(2) : "");
      const id = presetFor(s.trigger, s.target, s.weekendTrigger);
      setPreset(id);
      if (!id) setAdvanced(true);
    }
    // Only re-sync when the onchain settings change, not on every render of the preview object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.state?.trigger, g.state?.target, g.state?.weekendTrigger]);

  const pick = (p: Preset) => {
    setPreset(p.id);
    setTrigger(p.trigger.toFixed(2));
    setTarget(p.target.toFixed(2));
    setWeekend(p.weekend.toFixed(2));
  };

  let fundRaw = 0n;
  try {
    fundRaw = fund.trim() ? parseUnits(fund.trim(), 6) : 0n;
  } catch {
    fundRaw = -1n;
  }
  const t = num(trigger);
  const tg = num(target);
  const w = weekend.trim() ? num(weekend) : 0;
  const valid = t >= 1.02 && tg > t && tg <= 3 && (w === 0 || (w >= t && w < tg)) && fundRaw >= 0n;
  const armed = !!g.state && g.state.trigger > 0;
  const health = g.state?.health;
  const hasDebt = health !== undefined && health > 0 && health < 100;

  return (
    <section className="card pad">
      <div className="eyebrow">Loan Guard · agent</div>
      <GuardLog />

      <div className="eyebrow" style={{ marginTop: 28 }}>
        Your guard
      </div>
      {!g.deployed ? (
        <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>
          Launching soon. The contract is being deployed on Base.
        </p>
      ) : !address && !GUARD_PREVIEW ? (
        <div style={{ marginTop: 12 }}>
          <ConnectButton full />
        </div>
      ) : (
        <>
          {g.state && (
            <div className="soft" style={{ padding: 18, borderRadius: 18, marginTop: 12, display: "grid", gap: 8, fontSize: 14 }}>
              <div className="rule">
                <span>Status</span>
                <span style={{ fontWeight: 600 }}>{armed ? (g.state.needed ? "Acting now" : "Armed") : "Off"}</span>
              </div>
              {hasDebt && health !== undefined && (
                <div className="rule">
                  <span>Your loan now</span>
                  <span>
                    Health <span className="num">{health.toFixed(2)}</span> · a <span className="num">{cushion(health)}%</span> drop liquidates
                  </span>
                </div>
              )}
              <div className="rule">
                <span>Reserve</span>
                <span className="num">{usd(g.state.reserve)}</span>
              </div>
              {g.state.lastProtect > 0 && (
                <div className="rule">
                  <span>Last top-up</span>
                  <span className="num">{mounted ? new Date(g.state.lastProtect * 1000).toLocaleString("en-US") : "…"}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 18 }}>How early should it step in?</div>
          <div className="presets" role="radiogroup" aria-label="Loan Guard setting">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                className={`preset${preset === p.id ? " on" : ""}`}
                disabled={busy}
                onClick={() => pick(p)}
              >
                <span className="preset-name">{p.name}</span>
                <span className="preset-body">
                  Steps in when a {cushion(p.trigger)}% drop would liquidate you. Repays until it would take {cushion(p.target)}%.
                </span>
              </button>
            ))}
          </div>
          {Number.isFinite(t) && Number.isFinite(tg) && (
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              {w > 0
                ? `From Friday 20:00 to Sunday 23:00 UTC it steps in earlier, at a ${cushion(w)}% cushion, because NAV can gap at the Monday open.`
                : "No separate weekend setting."}
            </p>
          )}

          <button type="button" className="linkish" style={{ marginTop: 6, fontSize: 13 }} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {advanced ? "Hide advanced" : "Advanced: set health factors yourself"}
          </button>
          {advanced && (
            <div className="grid-3" style={{ marginTop: 10 }}>
              <label className="field">
                Trigger
                <input
                  className="input num"
                  inputMode="decimal"
                  value={trigger}
                  onChange={(e) => {
                    setTrigger(e.target.value);
                    setPreset(undefined);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="field">
                Target
                <input
                  className="input num"
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPreset(undefined);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="field">
                Weekend
                <input
                  className="input num"
                  inputMode="decimal"
                  placeholder="off"
                  value={weekend}
                  onChange={(e) => {
                    setWeekend(e.target.value);
                    setPreset(undefined);
                  }}
                  disabled={busy}
                />
              </label>
            </div>
          )}

          <label className="field" style={{ display: "block", marginTop: 14 }}>
            Add USDC to the reserve
            <input className="input num" inputMode="decimal" placeholder="0" value={fund} onChange={(e) => setFund(e.target.value)} disabled={busy} />
          </label>
          {!valid && <p className="err">Trigger must be at least 1.02, target above trigger (max 3), weekend between them.</p>}

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <button
              className="btn btn-blue"
              style={{ width: "100%", height: 54, fontSize: 16 }}
              disabled={!valid || busy || !g.builderCodeConfigured}
              onClick={() => g.arm(t, tg, w, fundRaw)}
            >
              {busy ? g.step ?? "Working…" : armed ? "Update guard" : "Turn on Loan Guard"}
            </button>
            {g.state && g.state.reserve > 0n && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => g.withdrawReserve(g.state!.reserve)}>
                Withdraw {usd(g.state.reserve)} reserve
              </button>
            )}
          </div>
          {previewNote && (
            <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>
              Preview mode: nothing was sent. This button opens your wallet once the contract is live.
            </p>
          )}
          {g.status === "success" && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              Done.{" "}
              {g.hashes.map((h) => (
                <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                  View tx
                </a>
              ))}
            </div>
          )}
          {g.error && <p className="err">{g.error}</p>}
        </>
      )}
      <p style={{ fontSize: 12, color: "var(--g60)", marginTop: 16 }}>
        It can only repay your loan or send your reserve back to you. It never touches your stocks. No owner, no admin key, not upgradeable, and
        anyone can trigger it, so it keeps working even if Stock Port goes down.
        {LOAN_GUARD && (
          <>
            {" "}
            <a href={basescanAddress(LOAN_GUARD)} target="_blank" rel="noreferrer">
              View the contract on Basescan
            </a>
            .
          </>
        )}
      </p>
    </section>
  );
}
