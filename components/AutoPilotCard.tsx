"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { publicClient } from "@/lib/publicClient";
import { marketClosed } from "@/lib/marketClock";
import { DEFAULT_RULES, decide, type AutoDecision, type AutoRules } from "@/lib/autopilot";
import { AP_MAX_SLIPPAGE_PCT, AP_MIN_DEPOSIT_USDC, AUTOPILOT, rulesFromPilot } from "@/lib/autopilotContract";
import { useAutoPilot } from "@/hooks/useAutoPilot";
import { basescanAddress, basescanTx } from "@/lib/txGuard";
import { USDC_BASE } from "@/lib/constants";
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
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sameRules = (a: AutoRules, b: AutoRules) =>
  a.autoRotate === b.autoRotate &&
  a.cutLosers === b.cutLosers &&
  a.weekendPause === b.weekendPause &&
  Math.abs(a.minEdgePct - b.minEdgePct) < 0.005 &&
  Math.abs(Math.abs(a.cutAtPct) - Math.abs(b.cutAtPct)) < 0.005 &&
  Math.max(1, Math.round(a.cadenceDays)) === Math.round(b.cadenceDays);

type AgentLine = { at: number; action: string; text: string; tx: string | null; error: string | null };
type AgentState = { live: boolean; agent: Address | null; users?: number; rebalances?: number; entries?: AgentLine[] };

/** Program your bag: set rules, then approve each move yourself (Tap) or let the agent trade inside them (Auto). */
export default function AutoPilotCard({
  baskets,
  stocks,
  geoBlocked,
  onApprove,
}: {
  baskets: Basket[];
  stocks: Record<string, StockInfo>;
  geoBlocked: boolean;
  onApprove: (from: string, to: string) => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const ap = useAutoPilot(walletClient, address);
  const [mode, setMode] = useState<"tap" | "auto">("tap");
  const [rules, setRules] = useState<AutoRules>(DEFAULT_RULES);
  const [slippage, setSlippage] = useState("1");
  const [deposit, setDeposit] = useState("");
  const [board, setBoard] = useState<BasketRow[]>([]);
  const [held, setHeld] = useState<Record<string, number>>({});
  const [lastAt, setLastAt] = useState<number>();
  const [now, setNow] = useState(0);
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const [agent, setAgent] = useState<AgentState>();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("pilot") === "auto") setMode("auto");
  }, []);

  // Tap rules and last rotation are saved per wallet in this browser. Auto rules live onchain.
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

  // When Auto is already on, show the rules the agent actually follows.
  const pilot = ap.state?.pilot;
  useEffect(() => {
    if (mode === "auto" && pilot && pilot.minInterval > 0) {
      setRules(rulesFromPilot(pilot));
      setSlippage(String(pilot.maxSlippageBps / 100));
    }
    // Re-sync only when the onchain pilot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pilot?.minInterval, pilot?.minEdgeBps, pilot?.cutAtBps, pilot?.maxSlippageBps, pilot?.autoRotate, pilot?.cutLosers, pilot?.weekendPause]);

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

  // The agent's public state and its log lines for this wallet.
  useEffect(() => {
    if (mode !== "auto") return;
    let live = true;
    const q = address ? `?user=${address}` : "";
    fetch(`/api/autopilot${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: AgentState) => live && setAgent(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode, address, now, ap.hashes]);

  const byAddr = useMemo(() => new Map(Object.values(stocks).filter((s) => s.address).map((s) => [s.address!.toLowerCase(), s])), [stocks]);

  // Tap: what the wallet holds. Auto: what sits inside AutoPilot. Both valued at NAV and summed per basket.
  useEffect(() => {
    if (!address) return setHeld({});
    const toBaskets = (bySym: Record<string, number>) =>
      setHeld(Object.fromEntries(baskets.map((b) => [b.id, b.legs.reduce((s, l) => s + (bySym[l.symbol] ?? 0), 0)])));
    if (mode === "auto") {
      const bySym: Record<string, number> = {};
      for (const [t, raw] of Object.entries(ap.state?.inside ?? {})) {
        const s = byAddr.get(t);
        if (s) bySym[s.symbol] = Number(formatUnits(raw, s.decimals ?? 8)) * (s.nav ?? 0);
      }
      return toBaskets(bySym);
    }
    const list = Object.values(stocks).filter((s) => s.address);
    Promise.all(
      list.map((s) =>
        publicClient
          .readContract({ address: s.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
          .then((v) => [s.symbol, Number(formatUnits(v, s.decimals ?? 8)) * (s.nav ?? 0)] as const)
          .catch(() => [s.symbol, 0] as const),
      ),
    ).then((rows) => toBaskets(Object.fromEntries(rows)));
  }, [address, stocks, baskets, now, mode, ap.state, byAddr]);

  const lastRotate = mode === "auto" ? (pilot?.lastTrade ? pilot.lastTrade * 1000 : undefined) : lastAt;
  const decision: AutoDecision | undefined = useMemo(
    () => (now && board.length ? decide({ rules, board, heldUsd: held, marketClosed: marketClosed(now), lastRotateAt: lastRotate, now }) : undefined),
    [rules, board, held, lastRotate, now],
  );

  // Tap log: a new line whenever the decision changes.
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

  // ---- Auto mode numbers
  const insideUsdc = ap.state?.inside[USDC_BASE.toLowerCase()] ?? 0n;
  const insideUsd =
    Number(formatUnits(insideUsdc, 6)) +
    Object.entries(ap.state?.inside ?? {}).reduce((s, [t, raw]) => {
      const st = byAddr.get(t);
      return st ? s + Number(formatUnits(raw, st.decimals ?? 8)) * (st.nav ?? 0) : s;
    }, 0);
  let depositRaw = 0n;
  try {
    depositRaw = deposit.trim() ? parseUnits(deposit.trim(), 6) : 0n;
  } catch {
    depositRaw = -1n;
  }
  const slip = Number(slippage);
  const slipOk = Number.isFinite(slip) && slip >= 0.1 && slip <= AP_MAX_SLIPPAGE_PCT;
  const agentAddr = agent?.agent ?? undefined;
  const isOn = !!pilot?.on && !!agentAddr && pilot.agent.toLowerCase() === agentAddr.toLowerCase();
  const firstDepositOk = insideUsd >= AP_MIN_DEPOSIT_USDC || depositRaw >= BigInt(AP_MIN_DEPOSIT_USDC) * 1_000_000n;
  const depositOk = depositRaw >= 0n && depositRaw <= (ap.state?.walletUsdc ?? 0n);
  const changed = !pilot || !isOn || !sameRules(rules, rulesFromPilot(pilot)) || Math.round(slip * 100) !== pilot.maxSlippageBps;
  const apAddr = AUTOPILOT;
  const busy = ap.status === "confirming" || ap.status === "pending";
  const canSave = !!agentAddr && !geoBlocked && slipOk && depositOk && firstDepositOk && (changed || depositRaw > 0n) && !busy;

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
          ? "Your rules run on the live 7-day NAV board while this page is open, and propose each move with its reason. You approve with one tap. Funds stay in your wallet."
          : "The agent trades for you inside your rules. A no-owner contract enforces every limit: only your agent, only between USDC and these stocks, never faster than your interval, and every swap must fill within your slippage cap of Chainlink NAV. Withdraw anytime."}
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
            <input className="input num ap-num" inputMode="decimal" value={Math.abs(rules.cutAtPct)} onChange={(e) => update({ cutAtPct: -Math.min(90, Math.abs(Number(e.target.value) || 0)) })} />% over 7 days
          </span>
        </label>
        <label className="ap-rule">
          <input
            type="checkbox"
            checked={mode === "auto" || rules.weekendPause}
            disabled={mode === "auto"}
            onChange={(e) => update({ weekendPause: e.target.checked })}
          />
          <span>Pause while markets are closed and NAV is frozen{mode === "auto" ? " (always on in Auto)" : ""}</span>
        </label>
        <label className="ap-rule">
          <span style={{ marginLeft: 26 }}>
            At most one move every
            <input className="input num ap-num" inputMode="numeric" value={rules.cadenceDays} onChange={(e) => update({ cadenceDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            days
          </span>
        </label>
        {mode === "auto" && (
          <label className="ap-rule">
            <span style={{ marginLeft: 26 }}>
              Max slippage vs NAV
              <input className="input num ap-num" inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value)} />% per swap (up to {AP_MAX_SLIPPAGE_PCT}%)
            </span>
          </label>
        )}
      </div>
      {mode === "auto" && rules.cadenceDays < 1 && <p className="muted" style={{ fontSize: 13 }}>Auto moves at most once a day, so 0 days is saved as 1.</p>}

      {!address ? (
        <div style={{ marginTop: 14 }}>
          <ConnectButton full />
        </div>
      ) : (
        <div className="ap-decision">
          {mode === "auto" && (
            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow">Your AutoPilot</div>
              {!apAddr ? (
                <p className="ap-soon">Auto mode turns on once the AutoPilot contract is live. Until then, use Tap to approve.</p>
              ) : (
                <>
                  <div className="ap-stats">
                    <div>
                      <span className="muted">Status</span>
                      <strong>{isOn ? "On" : pilot?.on ? "On, other agent" : "Off"}</strong>
                    </div>
                    <div>
                      <span className="muted">Inside AutoPilot</span>
                      <strong className="num">{usd(insideUsd)}</strong>
                    </div>
                    <div>
                      <span className="muted">In your wallet</span>
                      <strong className="num">{usd(Number(formatUnits(ap.state?.walletUsdc ?? 0n, 6)))} USDC</strong>
                    </div>
                  </div>
                  <label className="ap-rule" style={{ marginTop: 12 }}>
                    <span>
                      Add
                      <input className="input num ap-num" style={{ width: 90 }} inputMode="decimal" placeholder="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                      USDC {insideUsd < AP_MIN_DEPOSIT_USDC ? `(at least ${AP_MIN_DEPOSIT_USDC} to start)` : "(optional)"}
                    </span>
                  </label>
                  {geoBlocked && <p className="err">Trading isn&apos;t available in your region.</p>}
                  {!agentAddr && <p className="err">The agent isn&apos;t running yet. Try again soon.</p>}
                  {depositRaw < 0n && <p className="err">Enter a valid USDC amount.</p>}
                  {depositRaw > (ap.state?.walletUsdc ?? 0n) && <p className="err">That&apos;s more USDC than your wallet holds.</p>}
                  {!slipOk && <p className="err">Slippage must be between 0.1% and {AP_MAX_SLIPPAGE_PCT}%.</p>}
                  <button
                    className="btn btn-blue"
                    style={{ width: "100%", marginTop: 12 }}
                    disabled={!canSave}
                    onClick={() => agentAddr && ap.save({ agent: agentAddr, on: true, rules, slippagePct: slip, deposit: depositRaw > 0n ? depositRaw : 0n }).then(() => setDeposit(""))}
                  >
                    {busy ? ap.step ?? "Working…" : isOn ? (changed ? "Save new rules onchain" : "Add USDC") : "Turn on Auto with these rules"}
                  </button>
                  {isOn && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="btn"
                        style={{ flex: 1 }}
                        disabled={busy || !slipOk}
                        onClick={() => agentAddr && ap.save({ agent: agentAddr, on: false, rules, slippagePct: slip, deposit: 0n })}
                      >
                        Pause agent
                      </button>
                      <button className="btn" style={{ flex: 1 }} disabled={busy || insideUsd <= 0} onClick={() => ap.exit()}>
                        Withdraw everything
                      </button>
                    </div>
                  )}
                  {!isOn && insideUsd > 0 && (
                    <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => ap.exit()}>
                      Withdraw everything
                    </button>
                  )}
                  {ap.error && <p className="err">{ap.error}</p>}
                  {ap.status === "success" && ap.hashes[0] && (
                    <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                      Done.{" "}
                      <a href={basescanTx(ap.hashes[0])} target="_blank" rel="noreferrer">
                        View tx
                      </a>
                    </p>
                  )}
                  <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    Contract:{" "}
                    <a href={basescanAddress(apAddr)} target="_blank" rel="noreferrer" className="num">
                      {apAddr.slice(0, 6)}…{apAddr.slice(-4)}
                    </a>
                    {agentAddr && (
                      <>
                        {" · "}Agent:{" "}
                        <a href={basescanAddress(agentAddr)} target="_blank" rel="noreferrer" className="num">
                          {agentAddr.slice(0, 6)}…{agentAddr.slice(-4)}
                        </a>
                      </>
                    )}
                    {typeof agent?.rebalances === "number" && ` · ${agent.rebalances} agent moves onchain`}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="eyebrow">{mode === "auto" ? "What the agent sees now" : "Agent decision"}</div>
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
            </>
          )}

          {mode === "tap" && log.length > 0 && (
            <div className="ag-log" style={{ marginTop: 12 }}>
              {log.map((l) => (
                <div key={l.at + l.text} className="ag-line">
                  <span className="num ag-time">{new Date(l.at).toISOString().slice(11, 16)} UTC</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          )}
          {mode === "auto" && apAddr && (
            <div className="ag-log" style={{ marginTop: 12 }}>
              {!agent?.entries?.length && (
                <div className="ag-line">
                  <span className="num ag-time">--:--</span>
                  <span>{isOn ? "Waiting for the agent's next check." : "Turn on Auto and the agent's moves show up here."}</span>
                </div>
              )}
              {agent?.entries?.map((l) => (
                <div key={l.at + l.text} className="ag-line">
                  <span className="num ag-time">{new Date(l.at).toISOString().slice(11, 16)} UTC</span>
                  <span>
                    {l.action === "rotate" || l.action === "buy" ? (l.error ? "Tried: " : "Moved: ") : ""}
                    {l.text}
                    {l.tx && (
                      <>
                        {" "}
                        <a href={basescanTx(l.tx)} target="_blank" rel="noreferrer">
                          tx
                        </a>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
