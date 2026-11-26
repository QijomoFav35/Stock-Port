"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { publicClient } from "@/lib/publicClient";
import { marketClosed } from "@/lib/marketClock";
import { DEFAULT_RULES, decide, type AutoDecision, type AutoRules } from "@/lib/autopilot";
import type { Basket } from "@/lib/baskets";
import type { BasketRow, Leaderboard } from "@/lib/leaderboard";
import type { StockInfo } from "@/components/BasketDesk";

const RULES_KEY = (a: string) => `sp_autopilot_rules_${a.toLowerCase()}`;
const LAST_KEY = (a: string) => `sp_autopilot_last_${a.toLowerCase()}`;
const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? ({ ...fallback, ...JSON.parse(v) } as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Program your bag: set rules, the agent checks them every minute and proposes the move with its reason. */
export default function AutoPilotCard({
  baskets,
  stocks,
  onApprove,
}: {
  baskets: Basket[];
  stocks: Record<string, StockInfo>;
  onApprove: (from: string, to: string) => void;
}) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"tap" | "auto">("tap");
  const [rules, setRules] = useState<AutoRules>(DEFAULT_RULES);
  const [board, setBoard] = useState<BasketRow[]>([]);
  const [held, setHeld] = useState<Record<string, number>>({});
  const [lastAt, setLastAt] = useState<number>();
  const [now, setNow] = useState(0);
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);

  // Rules and last rotation are saved per wallet in this browser.
  useEffect(() => {
    if (!address) return;
    setRules(read(RULES_KEY(address), DEFAULT_RULES));
    const l = read<{ at?: number }>(LAST_KEY(address), {});
    setLastAt(l.at);
  }, [address]);
  const update = (patch: Partial<AutoRules>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    try {
      if (address) localStorage.setItem(RULES_KEY(address), JSON.stringify(next));
    } catch {}
  };

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/leaderboard")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((lb: Leaderboard) => live && setBoard(lb.baskets))
        .catch(() => {});
    load();
    setNow(Date.now());
    const a = setInterval(load, 5 * 60_000);
    const b = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      live = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  // What the wallet holds, valued at NAV, then summed per basket.
  useEffect(() => {
    if (!address) return setHeld({});
    const list = Object.values(stocks).filter((s) => s.address);
    Promise.all(
      list.map((s) =>
        publicClient
          .readContract({ address: s.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
          .then((v) => [s.symbol, Number(formatUnits(v, s.decimals ?? 8)) * (s.nav ?? 0)] as const)
          .catch(() => [s.symbol, 0] as const),
      ),
    ).then((rows) => {
      const bySym = Object.fromEntries(rows);
      setHeld(Object.fromEntries(baskets.map((b) => [b.id, b.legs.reduce((s, l) => s + (bySym[l.symbol] ?? 0), 0)])));
    });
  }, [address, stocks, baskets, now]);

  const decision: AutoDecision | undefined = useMemo(
    () => (now && board.length ? decide({ rules, board, heldUsd: held, marketClosed: marketClosed(now), lastRotateAt: lastAt, now }) : undefined),
    [rules, board, held, lastAt, now],
  );

  // Agent log: a new line whenever the decision changes.
  useEffect(() => {
    if (!decision) return;
    setLog((l) => (l[0]?.text === decision.reason ? l : [{ at: Date.now(), text: decision.reason }, ...l].slice(0, 8)));
  }, [decision]);

  const name = (id: string) => baskets.find((b) => b.id === id)?.name ?? id;
  const approve = (from: string, to: string) => {
    try {
      if (address) localStorage.setItem(LAST_KEY(address), JSON.stringify({ at: Date.now() }));
    } catch {}
    setLastAt(Date.now());
    onApprove(from, to);
  };

  return (
    <div className="card pad ap">
      <div className="eyebrow">AutoPilot · program your bag</div>

      <div role="tablist" aria-label="AutoPilot mode" className="ap-modes">
        {(["tap", "auto"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {m === "tap" ? "Tap to approve" : "Auto"}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        {mode === "tap"
          ? "The agent checks your rules every minute and proposes each move with its reason. You approve with one tap. Funds stay in your wallet."
          : "The agent acts for you inside your rules. A no-owner contract enforces the limits, and you can withdraw or switch it off anytime."}
      </p>

      <div className="ap-rules">
        <label className="ap-rule">
          <input type="checkbox" checked={rules.autoRotate} onChange={(e) => update({ autoRotate: e.target.checked })} />
          <span>
            Rotate into the 7-day leader when it beats my basket by
            <input className="input num ap-num" inputMode="decimal" value={rules.minEdgePct} onChange={(e) => update({ minEdgePct: Math.max(0, Number(e.target.value) || 0) })} />
            pts
          </span>
        </label>
        <label className="ap-rule">
          <input type="checkbox" checked={rules.cutLosers} onChange={(e) => update({ cutLosers: e.target.checked })} />
          <span>
            Cut a losing basket when it&apos;s down
            <input className="input num ap-num" inputMode="decimal" value={Math.abs(rules.cutAtPct)} onChange={(e) => update({ cutAtPct: -Math.abs(Number(e.target.value) || 0) })} />% over 7 days
          </span>
        </label>
        <label className="ap-rule">
          <input type="checkbox" checked={rules.weekendPause} onChange={(e) => update({ weekendPause: e.target.checked })} />
          <span>Pause while markets are closed and NAV is frozen</span>
        </label>
        <label className="ap-rule">
          <span style={{ marginLeft: 26 }}>
            At most one move every
            <input className="input num ap-num" inputMode="numeric" value={rules.cadenceDays} onChange={(e) => update({ cadenceDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            days
          </span>
        </label>
      </div>

      {!address ? (
        <div style={{ marginTop: 14 }}>
          <ConnectButton full />
        </div>
      ) : (
        <div className="ap-decision">
          <div className="eyebrow">Agent decision</div>
          {!decision && <p className="muted">Reading the 7-day NAV board…</p>}
          {decision && (
            <>
              <p style={{ margin: "8px 0 0", fontWeight: 600 }}>
                {decision.action === "rotate" ? `Rotate ${name(decision.from)} → ${name(decision.to)}` : decision.action === "buy" ? `Buy ${name(decision.to)}` : "Hold"}
              </p>
              <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{decision.reason}</p>
              {mode === "tap" && decision.action === "rotate" && (
                <button className="btn btn-blue" style={{ width: "100%", marginTop: 12 }} onClick={() => approve(decision.from, decision.to)}>
                  Review and approve
                </button>
              )}
              {mode === "tap" && decision.action === "buy" && (
                <button className="btn btn-blue" style={{ width: "100%", marginTop: 12 }} onClick={() => onApprove("", decision.to)}>
                  Buy {name(decision.to)}
                </button>
              )}
              {mode === "auto" && <p className="ap-soon">Auto mode turns on once the AutoPilot contract is live. Until then, use Tap to approve.</p>}
            </>
          )}
          {log.length > 0 && (
            <div className="ag-log" style={{ marginTop: 12 }}>
              {log.map((l) => (
                <div key={l.at + l.text} className="ag-line">
                  <span className="num ag-time">{new Date(l.at).toISOString().slice(11, 16)} UTC</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
