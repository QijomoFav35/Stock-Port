"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { useBorrow, healthAfter, liquidationPrice, safeBorrowUsd, type StockRow } from "@/hooks/useBorrow";
import { AAVE_SPOKE, MIN_HEALTH } from "@/lib/aave";
import { basescanAddress } from "@/lib/txGuard";

const ATTEST_KEY = "sp_attest_non_us";
const usdN = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const big = (n: number) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : n.toFixed(0));
const qty = (raw: bigint) => Number(formatUnits(raw, 8)).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const pct = (x?: number) => (x !== undefined && Number.isFinite(x) ? (x * 100).toFixed(2) + "%" : "—");
const parse = (v: string, d: number) => {
  try {
    return v.trim() ? parseUnits(v.trim(), d) : 0n;
  } catch {
    return -1n;
  }
};

function HealthBar({ h }: { h: number }) {
  const label = !Number.isFinite(h) ? "No loan" : h >= 1.6 ? "Safe" : h >= MIN_HEALTH ? "Watch" : "At risk";
  const color = !Number.isFinite(h) || h >= 1.6 ? "#B6F569" : h >= MIN_HEALTH ? "#FFD12F" : "#FC401F";
  const fill = !Number.isFinite(h) ? 100 : Math.max(4, Math.min(100, (h - 1) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--g60)" }}>
        <span>Health after this</span>
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

/** Borrow USDC against a tokenized stock on Aave V4, without selling it. */
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

  const row: StockRow | undefined = b.rows?.find((r) => r.reserve.symbol === sym);
  const depRaw = parse(dep, 8);
  const amtRaw = parse(amt, 6);
  const busy = b.status === "confirming" || b.status === "pending";
  const cf = row ? b.market?.factors[row.reserve.symbol] ?? row.reserve.collateralFactor : 0;

  const preview = useMemo(() => {
    if (!row || !b.acct || depRaw < 0n || amtRaw < 0n) return undefined;
    const addQty = Number(depRaw) / 1e8;
    const idle = row.usingAsCollateral ? 0 : (Number(row.supplied) / 1e8) * row.price;
    const addColl = addQty * row.price + idle;
    const addDebt = Number(amtRaw) / 1e6;
    const room = Math.min(safeBorrowUsd(b.acct, addColl, cf), b.market?.usdcAvailable ?? 0);
    return {
      h: healthAfter(b.acct, addColl, cf, addDebt),
      liq: liquidationPrice(b.acct, row, addQty, addDebt, cf),
      room,
      debtAfter: b.acct.debtUsd + addDebt,
    };
  }, [row, b.acct, b.market, depRaw, amtRaw, cf]);

  if (geoBlocked) {
    return (
      <section className="card pad">
        <div className="eyebrow">Borrow</div>
        <p className="muted" style={{ marginTop: 12 }}>Borrowing isn&apos;t available in your region.</p>
      </section>
    );
  }

  return (
    <section className="card pad">
      <div className="eyebrow">Aave V4 on Base</div>
      <div className="disp card-title">
        Get USDC. <em>Keep your bags.</em>
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
        {b.market ? (
          <>
            {big(b.market.usdcAvailable)} USDC ready to borrow at {pct(b.market.borrowApy)} APY.
          </>
        ) : (
          "Reading Aave on Base…"
        )}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {(b.rows ?? []).map((r) => {
          const on = r.reserve.symbol === sym;
          const f = b.market?.factors[r.reserve.symbol] ?? r.reserve.collateralFactor;
          return (
            <button
              key={r.reserve.symbol}
              onClick={() => setSym(r.reserve.symbol)}
              disabled={busy}
              className="btn btn-sm"
              style={{ background: on ? "var(--ink)" : "#fff", color: on ? "#fff" : "var(--ink)", border: "1px solid var(--line-hi)", boxShadow: "none" }}
            >
              {r.reserve.symbol}
              <span className="num" style={{ opacity: 0.7, marginLeft: 6 }}>{Math.round(f * 100)}%</span>
            </button>
          );
        })}
      </div>
      {b.loadError && <p className="err" style={{ marginTop: 16 }}>Couldn&apos;t read Aave: {b.loadError}</p>}

      {row && preview && b.acct && (
        <>
          <div className="soft" style={{ padding: 18, borderRadius: 18, marginTop: 16, display: "grid", gap: 8, fontSize: 14 }}>
            <div className="rule">
              <span>{row.reserve.symbol} NAV (Chainlink)</span>
              <span className="num">{usdN(row.price)}</span>
            </div>
            <div className="rule">
              <span>Max LTV</span>
              <span className="num">{Math.round(cf * 100)}%</span>
            </div>
            {address && (
              <>
                <div className="rule">
                  <span>{row.reserve.symbol} deposited · in wallet</span>
                  <span className="num">
                    {qty(row.supplied)} · {qty(row.wallet)}
                  </span>
                </div>
                <div className="rule">
                  <span>Your loan</span>
                  <span className="num">
                    {usdN(b.acct.debtUsd)} owed · health {Number.isFinite(b.acct.health) ? b.acct.health.toFixed(2) : "∞"}
                  </span>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Deposit {row.reserve.symbol}
              {address && (
                <button className="linkish" onClick={() => setDep(formatUnits(row.wallet, 8))} style={{ marginLeft: 8 }}>
                  Max {qty(row.wallet)}
                </button>
              )}
              <input className="input num" inputMode="decimal" placeholder="0" value={dep} onChange={(e) => setDep(e.target.value)} disabled={busy} />
            </label>
            <label style={{ fontSize: 13, color: "var(--g60)" }}>
              Borrow USDC
              <button className="linkish" onClick={() => setAmt((Math.floor(preview.room * 100) / 100).toFixed(2))} style={{ marginLeft: 8 }}>
                Safe max {usdN(preview.room)}
              </button>
              <input className="input num" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy} />
            </label>
            <HealthBar h={preview.h} />
            <div style={{ fontSize: 13, color: "var(--g60)" }}>
              {preview.debtAfter > 0 ? (
                preview.liq > 0 ? (
                  <>
                    Liquidated if {row.reserve.symbol} falls below <b className="num" style={{ color: "var(--ink)" }}>{usdN(preview.liq)}</b> (
                    {((1 - preview.liq / row.price) * 100).toFixed(1)}% away). We stop new loans under health {MIN_HEALTH}.
                  </>
                ) : (
                  <>Your other collateral covers this loan on its own.</>
                )
              ) : (
                <>No loan, no liquidation risk.</>
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
                  {busy ? b.step ?? "Working…" : amtRaw > 0n ? `${depRaw > 0n ? "Deposit and borrow" : "Borrow"} ${usdN(Number(amtRaw) / 1e6)}` : "Deposit"}
                </button>
                {(b.acct.debtRaw > 0n || row.supplied > 0n) && (
                  <button className="btn btn-ghost" disabled={!attest || busy} onClick={() => b.repayAndWithdraw(row, attest)}>
                    {b.acct.debtRaw > 0n ? `Repay ${usdN(b.acct.debtUsd)} and withdraw ${row.reserve.symbol}` : `Withdraw ${row.reserve.symbol}`}
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
          {b.error && <p className="err">{b.error}</p>}
          <p style={{ fontSize: 12, color: "var(--g60)", marginTop: 14 }}>
            Self-custody: your stock sits in{" "}
            <a href={basescanAddress(AAVE_SPOKE)} target="_blank" rel="noreferrer">
              Aave&apos;s contract
            </a>
            , never with us. Approvals are exact. Variable rate. Prices update 24/5 and loans can be liquidated if the stock falls.
          </p>
        </>
      )}
    </section>
  );
}
