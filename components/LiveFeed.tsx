"use client";
import { useEffect, useRef, useState } from "react";
import { basescanTx } from "@/lib/txGuard";
import type { LiveFeed as Feed, LiveFlow } from "@/lib/live";

const VERB: Record<LiveFlow["kind"], string> = { buy: "Buy", sell: "Sell", mint: "Mint", redeem: "Redeem" };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
const qty = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(2));
const usd = (n?: number) => (n === undefined ? "" : `$${n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`);

/** Live arrivals board: real tokenized-stock flows on Base and what our agents checked, refreshed every 15 s. */
export default function LiveFeed() {
  const [feed, setFeed] = useState<Feed>();
  const [failed, setFailed] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/live")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((f: Feed) => {
          if (!live) return;
          // Animate only rows that weren't on screen before (not the whole list on first load).
          const first = seen.current.size === 0;
          const added = new Set<string>();
          for (const x of f.flows) {
            const k = x.hash + x.symbol;
            if (!seen.current.has(k) && !first) added.add(k);
            seen.current.add(k);
          }
          setFresh(added);
          setFeed(f);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    load();
    const id = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="card pad live">
      <div className="live-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="eyebrow">Live on Base</span>
        {feed && <span className="muted live-win">last {feed.windowMin < 60 ? `${Math.round(feed.windowMin)} min` : "hour"}</span>}
      </div>

      {feed && feed.agents.length > 0 && (
        <div className="live-agents">
          {feed.agents.slice(0, 4).map((a) => (
            <div key={a.agent + a.text} className="live-agent">
              <span className={a.ok ? "live-ok" : "live-warn"} aria-hidden="true" />
              <b>{a.agent}</b>
              <span className="num">{a.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="live-rows" aria-live="polite">
        {!feed && !failed && <p className="muted">Reading Base…</p>}
        {failed && !feed && <p className="err">Couldn&apos;t read the chain right now.</p>}
        {feed && feed.flows.length === 0 && <p className="muted">Quiet on the docks. No tokenized stock trades in the last hour.</p>}
        {feed?.flows.map((f) => (
          <a
            key={f.hash + f.symbol}
            href={basescanTx(f.hash)}
            target="_blank"
            rel="noreferrer"
            className={`live-row${fresh.has(f.hash + f.symbol) ? " live-new" : ""}${f.port ? " live-port" : ""}`}
          >
            <span className={`live-kind live-${f.kind}`}>{VERB[f.kind]}</span>
            <span className="num live-amt">
              {qty(f.amount)} {f.symbol}
            </span>
            <span className="num muted">{usd(f.usd)}</span>
            {f.port && <span className="live-tag">via Stock Port</span>}
            <span className="num muted live-ago">{ago(f.ago)}</span>
          </a>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Every row is a real tx. Click to verify on Basescan. USD at Chainlink NAV.
      </p>
    </div>
  );
}
