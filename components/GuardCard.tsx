"use client";
import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { useLoanGuard } from "@/hooks/useLoanGuard";
import { LOAN_GUARD } from "@/lib/loanGuard";
import { basescanAddress } from "@/lib/txGuard";

const usd = (raw: bigint) => "$" + Number(formatUnits(raw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Gate B1: Loan Guard. A USDC reserve that repays your Aave loan before liquidation. */
export default function GuardCard() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const g = useLoanGuard(walletClient, address);
  const [trigger, setTrigger] = useState("1.15");
  const [target, setTarget] = useState("1.40");
  const [weekend, setWeekend] = useState("1.30");
  const [fund, setFund] = useState("");
  const busy = g.status === "confirming" || g.status === "pending";

  useEffect(() => {
    if (g.state && g.state.trigger > 0) {
      setTrigger(g.state.trigger.toFixed(2));
      setTarget(g.state.target.toFixed(2));
      setWeekend(g.state.weekendTrigger ? g.state.weekendTrigger.toFixed(2) : "");
    }
  }, [g.state]);

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

  return (
    <section className="card pad" style={{ padding: 32, scrollMarginTop: 80 }} id="guard">
      <div className="eyebrow">Gate B1 · Loan Guard</div>
      <div className="disp" style={{ fontSize: 30, marginTop: 8 }}>
        Never get <em>liquidated</em> in your sleep.
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
        Park a USDC reserve. If your Aave health drops under your trigger, the guard repays just enough to get you back to your target. Stock
        prices freeze on weekends, so a higher weekend trigger tops you up before the Monday open. It can only repay your loan or send your
        reserve back to you. It can never touch your stocks.
      </p>

      {!g.deployed ? (
        <p style={{ marginTop: 16, fontSize: 14, color: "var(--g60)" }}>Launching soon. The contract is being deployed on Base.</p>
      ) : !address ? (
        <div style={{ marginTop: 16 }}>
          <ConnectButton full />
        </div>
      ) : (
        <>
          {g.state && (
            <div className="soft" style={{ padding: 18, borderRadius: 18, marginTop: 16, display: "grid", gap: 8, fontSize: 14 }}>
              <div className="rule">
                <span>Status</span>
                <span className="num" style={{ fontWeight: 600 }}>
                  {armed ? (g.state.needed ? "Acting now" : "Armed") : "Off"}
                </span>
              </div>
              <div className="rule">
                <span>Reserve</span>
                <span className="num">{usd(g.state.reserve)}</span>
              </div>
              {armed && (
                <div className="rule">
                  <span>Trigger · target · weekend</span>
                  <span className="num">
                    {g.state.trigger.toFixed(2)} · {g.state.target.toFixed(2)} · {g.state.weekendTrigger ? g.state.weekendTrigger.toFixed(2) : "same"}
                  </span>
                </div>
              )}
              {g.state.lastProtect > 0 && (
                <div className="rule">
                  <span>Last top-up</span>
                  <span className="num">{new Date(g.state.lastProtect * 1000).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Trigger
              <input className="input num" inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value)} disabled={busy} />
            </label>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Target
              <input className="input num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} />
            </label>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Weekend
              <input className="input num" inputMode="decimal" placeholder="off" value={weekend} onChange={(e) => setWeekend(e.target.value)} disabled={busy} />
            </label>
          </div>
          <label style={{ fontSize: 13, color: "var(--g60)", display: "block", marginTop: 10 }}>
            Add USDC to the reserve
            <input className="input num" inputMode="decimal" placeholder="0" value={fund} onChange={(e) => setFund(e.target.value)} disabled={busy} />
          </label>
          {!valid && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>Trigger must be at least 1.02, target above trigger (max 3), weekend between them.</p>}

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <button className="btn btn-blue" style={{ width: "100%", height: 54, fontSize: 16 }} disabled={!valid || busy || !g.builderCodeConfigured} onClick={() => g.arm(t, tg, w, fundRaw)}>
              {busy ? g.step ?? "Working…" : armed ? "Update guard" : "Turn on Loan Guard"}
            </button>
            {g.state && g.state.reserve > 0n && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => g.withdrawReserve(g.state!.reserve)}>
                Withdraw {usd(g.state.reserve)} reserve
              </button>
            )}
          </div>
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
          {g.error && <p style={{ fontSize: 14, color: "var(--red)", marginTop: 12 }}>{g.error}</p>}
          {LOAN_GUARD && (
            <p style={{ fontSize: 12, color: "var(--g60)", marginTop: 14 }}>
              Open source, no owner, no admin key, not upgradeable:{" "}
              <a href={basescanAddress(LOAN_GUARD)} target="_blank" rel="noreferrer">
                LoanGuard on Basescan
              </a>
              . Anyone can trigger it, so it keeps working even if Stock Port goes down.
            </p>
          )}
        </>
      )}
    </section>
  );
}
