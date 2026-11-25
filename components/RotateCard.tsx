"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import ConnectButton from "@/components/ConnectButton";
import Icon from "@/components/Icon";
import ShareButtons from "@/components/ShareButtons";
import { publicClient } from "@/lib/publicClient";
import { basescanAddress } from "@/lib/txGuard";
import { useRotate, usdText, spenderName } from "@/hooks/useRotate";
import type { Basket } from "@/lib/baskets";
import type { StockInfo } from "@/components/BasketDesk";

const ATTEST_KEY = "sp_attest_non_us";
const ROUTE = { aerodrome: "Aerodrome", o1: "o1 Exchange", "0x": "0x" } as const;
const qty = (raw: string, dec: number) => Number(formatUnits(BigInt(raw), dec)).toLocaleString(undefined, { maximumSignificantDigits: 4 });

/** Rotate out of one basket into the selected one, in one batch. */
export default function RotateCard({
  baskets,
  to,
  stocks,
  geoBlocked,
}: {
  baskets: Basket[];
  to: Basket;
  stocks: Record<string, StockInfo>;
  geoBlocked: boolean;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const r = useRotate(walletClient, address);
  const [attest, setAttest] = useState(false);
  const [held, setHeld] = useState<Record<string, number>>({});
  const others = baskets.filter((b) => b.id !== to.id);
  const [fromId, setFromId] = useState(others[0]?.id ?? "");

  useEffect(() => {
    try {
      setAttest(localStorage.getItem(ATTEST_KEY) === "1");
    } catch {}
  }, []);

  // USD value of what the wallet holds per stock (balance × NAV), to show which baskets you can rotate out of.
  useEffect(() => {
    if (!address) return setHeld({});
    const list = Object.values(stocks).filter((s) => s.address);
    Promise.all(
      list.map((s) =>
        publicClient
          .readContract({ address: s.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
          .then((b) => [s.symbol, Number(formatUnits(b, s.decimals ?? 8)) * (s.nav ?? 0)] as const)
          .catch(() => [s.symbol, 0] as const),
      ),
    ).then((rows) => setHeld(Object.fromEntries(rows)));
  }, [address, stocks, r.result]);

  const value = useMemo(
    () => Object.fromEntries(baskets.map((b) => [b.id, b.legs.reduce((s, l) => s + (held[l.symbol] ?? 0), 0)])),
    [baskets, held],
  );
  // Default the source to the basket you hold the most of.
  useEffect(() => {
    const best = [...others].sort((a, b) => (value[b.id] ?? 0) - (value[a.id] ?? 0))[0];
    if (best && (value[best.id] ?? 0) > 0) setFromId(best.id);
  }, [value, to.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = baskets.find((b) => b.id === fromId) ?? others[0];
  const busy = r.status === "quoting" || r.status === "confirming" || r.status === "pending";

  if (geoBlocked) {
    return (
      <section className="card pad" style={{ padding: 32 }}>
        <div className="eyebrow">Rotate</div>
        <p className="muted" style={{ marginTop: 12 }}>Trading isn&apos;t available in your region.</p>
      </section>
    );
  }

  if (r.status === "success" && r.result) {
    const q = r.result.quote;
    return (
      <section className="card pad" style={{ padding: 32, textAlign: "center" }}>
        <div className="eyebrow">Rotated</div>
        <div className="disp" style={{ fontSize: 32, marginTop: 10 }}>
          {q.from.name} → <em>{q.to.name}</em>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>{usdText(q.usdcIn)} moved in {r.result.mode === "batch" ? "one tx" : `${r.result.txHashes.length} txs`}.</p>
        <ShareButtons hashes={r.result.txHashes} spent={Number(formatUnits(BigInt(q.usdcIn), 6))} basket={{ id: q.to.id, name: q.to.name }} />
        <div style={{ marginTop: 14, display: "grid", gap: 4, fontSize: 14 }}>
          {r.result.txHashes.map((h, i) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer">
              View tx {r.result!.txHashes.length > 1 ? i + 1 : ""} on Basescan
            </a>
          ))}
        </div>
        <button onClick={r.reset} className="btn btn-ghost" style={{ marginTop: 16 }}>
          Rotate again
        </button>
      </section>
    );
  }

  return (
    <section className="card pad" style={{ padding: 32 }}>
      <div className="eyebrow">Rotate into {to.name}</div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <label style={{ fontSize: 13, color: "var(--g60)" }}>Out of</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {others.map((b) => {
            const on = b.id === from?.id;
            const v = value[b.id] ?? 0;
            return (
              <button
                key={b.id}
                onClick={() => setFromId(b.id)}
                disabled={busy || r.status === "review"}
                className="btn btn-sm"
                style={{
                  background: on ? "var(--ink)" : "#fff",
                  color: on ? "#fff" : "var(--ink)",
                  border: "1px solid var(--line-hi)",
                  boxShadow: "none",
                }}
              >
                {b.name}
                {address && <span className="num" style={{ opacity: 0.7, marginLeft: 6 }}>{v > 0 ? "$" + v.toFixed(2) : "$0"}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", color: "var(--g60)", fontSize: 14, marginTop: 6 }}>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>{from?.name}</span>
          <Icon name="ph-arrow-right" size={16} />
          <span style={{ fontWeight: 600, color: "var(--blue)" }}>{to.name}</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--g60)", margin: 0 }}>
          Sells all your {from?.legs.map((l) => l.symbol).join(", ")} and buys {to.name} with the USDC, in one batch when your wallet
          supports it. If any leg fails, nothing moves.
        </p>
      </div>

      {r.status === "review" && r.quote ? (
        <div className="soft" style={{ padding: 18, borderRadius: 18, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Review rotation</div>
          <div style={{ marginTop: 10, fontWeight: 600, fontSize: 14 }}>Sell</div>
          {r.quote.sells.legs.map((l) => (
            <div key={l.token} className="rule" style={{ fontSize: 14 }}>
              <span>
                {qty(l.amountIn, l.decimals)} {l.symbol} <span style={{ color: "var(--g60)" }}>via {ROUTE[l.provider]}</span>
              </span>
              <span className="num">min {usdText(l.minUsdc)}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontWeight: 600, fontSize: 14 }}>Buy {r.quote.to.name}</div>
          {r.quote.buy.legs.map((l) => (
            <div key={l.token} className="rule" style={{ fontSize: 14 }}>
              <span>
                {l.symbol} <span style={{ color: "var(--g60)" }}>via {ROUTE[r.quote!.buy.provider]}</span>
              </span>
              <span className="num">{usdText(l.sellAmount)}</span>
            </div>
          ))}
          <div style={{ fontSize: 13, color: "var(--g60)", marginTop: 10 }}>
            Approvals are exact: each stock for the amount sold, USDC for {usdText(r.quote.usdcIn)}. Spenders:{" "}
            {[...new Set([...r.quote.sells.approvals.map((a) => a.spender), ...(r.quote.buy.approval ? [r.quote.buy.approval.spender] : [])])].map(
              (s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <a href={basescanAddress(s)} target="_blank" rel="noreferrer">
                    {spenderName(s)}
                  </a>
                </span>
              ),
            )}
            . USDC above the minimum stays in your wallet.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={r.cancel} className="btn btn-ghost" style={{ flex: 1 }}>
              Cancel
            </button>
            <button onClick={r.confirm} className="btn btn-blue" style={{ flex: 2 }}>
              Confirm in wallet
            </button>
          </div>
        </div>
      ) : (
        <>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => {
                setAttest(e.target.checked);
                try {
                  localStorage.setItem(ATTEST_KEY, e.target.checked ? "1" : "0");
                } catch {}
              }}
              style={{ marginTop: 3 }}
            />
            I&apos;m not a US person and I&apos;m not in a restricted region.
          </label>
          <div style={{ marginTop: 14 }}>
            {!address ? (
              <ConnectButton full />
            ) : (
              <button
                onClick={() => from && r.rotate(from.id, to.id, attest)}
                disabled={!attest || busy || !from || !r.builderCodeConfigured || (value[from.id] ?? 0) <= 0}
                className="btn btn-blue"
                style={{ width: "100%", height: 54, fontSize: 16 }}
              >
                {busy ? r.step ?? "Working…" : `Rotate ${from?.name ?? ""} → ${to.name}`}
              </button>
            )}
            {address && from && (value[from.id] ?? 0) <= 0 && (
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--g60)", marginTop: 8 }}>
                You don&apos;t hold any {from.name} yet. Buy a basket first, then rotate.
              </div>
            )}
          </div>
        </>
      )}
      {r.error && <p style={{ fontSize: 14, color: "var(--red)", marginTop: 12 }}>{r.error}</p>}
    </section>
  );
}
