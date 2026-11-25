"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { useBorrow, type BorrowRow } from "@/hooks/useBorrow";
import { MORPHO, SAFE_LTV_SHARE, collateralValue, health, liquidationPrice, maxDebt } from "@/lib/morpho";
import { basescanAddress } from "@/lib/txGuard";

const ATTEST_KEY = "sp_attest_non_us";
const DEC = 8;
const usd = (raw: bigint) => "$" + Number(formatUnits(raw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdN = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (raw: bigint) => Number(formatUnits(raw, DEC)).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(2) + "%" : "—");
const parse = (v: string, d: number) => {
  try {
    return v.trim() ? parseUnits(v.trim(), d) : 0n;
  } catch {
    return -1n;
  }
};

function HealthBar({ h }: { h: number }) {
  const label = !Number.isFinite(h) ? "No loan" : h >= 1.5 ? "Safe" : h >= 1.15 ? "Watch" : "At risk";
  const color = !Number.isFinite(h) || h >= 1.5 ? "#B6F569" : h >= 1.15 ? "#FFD12F" : "#FC401F";
  const fill = !Number.isFinite(h) ? 100 : Math.max(4, Math.min(100, ((h - 1) / 1) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--g60)" }}>
        <span>Health</span>
        <span className="num" style={{ color: "var(--ink)", fontWeight: 600 }}>
          {Number.isFinite(h) ? h.toFixed(2) : "∞"} · {label}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--raised)", marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${fill}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

/** Borrow USDC against a tokenized stock on Morpho, without selling it. */
export default function BorrowCard({ geoBlocked, initial = "NVDAc" }: { geoBlocked: boolean; initial?: string }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const b = useBorrow(walletClient, address);
  const [sym, setSym] = useState(initial);
  const [dep, setDep] = useState("");
  const [amt, setAmt] = useState("");
  const [attest, setAttest] = useState(false);

  useEffect(() => {
    try {
      setAttest(localStorage.getItem(ATTEST_KEY) === "1");
    } catch {}
  }, []);

  const row: BorrowRow | undefined = b.rows?.find((r) => r.market.symbol === sym);
  const depRaw = parse(dep, DEC);
  const amtRaw = parse(amt, 6);
  const busy = b.status === "confirming" || b.status === "pending";

  const preview = useMemo(() => {
    if (!row || depRaw < 0n || amtRaw < 0n) return undefined;
    const coll = row.collateral + depRaw;
    const debt = row.debt + amtRaw;
    const lltv = row.market.params.lltv;
    const safeMax = (maxDebt(coll, row.price, lltv) * BigInt(Math.round(SAFE_LTV_SHARE * 1000))) / 1000n;
    const room = safeMax > row.debt ? safeMax - row.debt : 0n;
    return {
      coll,
      debt,
      h: health(coll, row.price, lltv, debt),
      liq: liquidationPrice(coll, debt, lltv, DEC),
      value: collateralValue(coll, row.price),
      room: room < row.liquidity ? room : row.liquidity,
    };
  }, [row, depRaw, amtRaw]);

  if (geoBlocked) {
    return (
      <section className="card pad" style={{ padding: 32 }}>
        <div className="eyebrow">Borrow</div>
        <p className="muted" style={{ marginTop: 12 }}>Borrowing isn&apos;t available in your region.</p>
      </section>
    );
  }

  const price = row ? Number(row.price) / 1e34 : 0;
  const lltv = row ? Number(row.market.params.lltv) / 1e18 : 0;

  return (
    <section className="card pad" style={{ padding: 32 }} id="borrow">
      <div className="eyebrow">Borrow · Morpho on Base</div>
      <div className="disp" style={{ fontSize: 30, marginTop: 8 }}>
        Get USDC. <em>Keep the stock.</em>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
        {(b.rows ?? []).map((r) => {
          const on = r.market.symbol === sym;
          return (
            <button
              key={r.market.id}
              onClick={() => setSym(r.market.symbol)}
              disabled={busy}
              className="btn btn-sm"
              style={{ background: on ? "var(--ink)" : "#fff", color: on ? "#fff" : "var(--ink)", border: "1px solid var(--line-hi)", boxShadow: "none" }}
            >
              {r.market.symbol}
              <span className="num" style={{ opacity: 0.7, marginLeft: 6 }}>{pct(r.apy)}</span>
            </button>
          );
        })}
      </div>
      {!b.rows && !b.loadError && <p className="muted" style={{ marginTop: 16 }}>Reading Morpho markets on Base…</p>}
      {b.loadError && <p style={{ marginTop: 16, color: "var(--red)", fontSize: 14 }}>Couldn&apos;t read Morpho: {b.loadError}</p>}

      {row && preview && (
        <>
          <div className="soft" style={{ padding: 18, borderRadius: 18, marginTop: 16, display: "grid", gap: 8, fontSize: 14 }}>
            <div className="rule">
              <span>{row.market.symbol} price (Chainlink)</span>
              <span className="num">{usdN(price)}</span>
            </div>
            <div className="rule">
              <span>Borrow APY · liquidation at</span>
              <span className="num">
                {pct(row.apy)} · {(lltv * 100).toFixed(1)}% LTV
              </span>
            </div>
            <div className="rule">
              <span>USDC left to borrow in this market</span>
              <span className="num">{usd(row.liquidity)}</span>
            </div>
            {address && (
              <div className="rule">
                <span>Your loan</span>
                <span className="num">
                  {qty(row.collateral)} {row.market.symbol} in · {usd(row.debt)} owed
                </span>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Deposit {row.market.symbol}{" "}
              {address && (
                <button className="linkish" onClick={() => setDep(formatUnits(row.wallet, DEC))} style={{ marginLeft: 6 }}>
                  Max {qty(row.wallet)}
                </button>
              )}
              <input className="input num" inputMode="decimal" placeholder="0" value={dep} onChange={(e) => setDep(e.target.value)} disabled={busy} />
            </label>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Borrow USDC{" "}
              <button className="linkish" onClick={() => setAmt(formatUnits(preview.room, 6))} style={{ marginLeft: 6 }}>
                Safe max {usd(preview.room)}
              </button>
              <input className="input num" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy} />
            </label>
            <HealthBar h={preview.h} />
            <div style={{ fontSize: 13, color: "var(--g60)" }}>
              {preview.debt > 0n ? (
                <>
                  Liquidated if {row.market.symbol} drops below <b className="num" style={{ color: "var(--ink)" }}>{usdN(preview.liq)}</b> (
                  {price > 0 ? ((1 - preview.liq / price) * 100).toFixed(1) : "—"}% away). We cap loans at {Math.round(SAFE_LTV_SHARE * 100)}% of the limit.
                </>
              ) : (
                <>Collateral value {usd(preview.value)}. No loan, no liquidation risk.</>
              )}
            </div>
          </div>

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

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {!address ? (
              <ConnectButton full />
            ) : (
              <>
                <button
                  className="btn btn-blue"
                  style={{ width: "100%", height: 54, fontSize: 16 }}
                  disabled={!attest || busy || depRaw < 0n || amtRaw < 0n || (depRaw === 0n && amtRaw === 0n) || !b.builderCodeConfigured}
                  onClick={() => b.borrow(row, depRaw, amtRaw, attest)}
                >
                  {busy ? b.step ?? "Working…" : amtRaw > 0n ? `Borrow ${usd(amtRaw)}` : "Deposit"}
                </button>
                {(row.debt > 0n || row.collateral > 0n) && (
                  <button className="btn btn-ghost" disabled={!attest || busy} onClick={() => b.repay(row, "all", true, attest)}>
                    Repay {row.debt > 0n ? usd(row.debt) + " " : ""}and withdraw {row.market.symbol}
                  </button>
                )}
              </>
            )}
          </div>
          {b.status === "success" && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              Done.{" "}
              {b.hashes.map((h) => (
                <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                  View tx
                </a>
              ))}
            </div>
          )}
          {b.error && <p style={{ fontSize: 14, color: "var(--red)", marginTop: 12 }}>{b.error}</p>}
          <p style={{ fontSize: 12, color: "var(--g60)", marginTop: 14 }}>
            Self-custody: your stock sits in the{" "}
            <a href={basescanAddress(MORPHO)} target="_blank" rel="noreferrer">
              Morpho contract
            </a>
            , never with us. Approvals are exact. Loans are variable rate and can be liquidated if the price falls.
          </p>
        </>
      )}
    </section>
  );
}
