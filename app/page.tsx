import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { parseBasket } from "@/lib/constants";
import { listTokenizedStocks, resolveSymbols, type TokenizedStock } from "@/lib/tokenizedStocks";
import { getPegHealth } from "@/lib/pegHealth";
import type { PegHealth } from "@/lib/peg";
import PegChip from "@/components/PegChip";
import Guardrails from "@/components/Guardrails";
import StockRadar from "@/components/StockRadar";
import PortCard from "@/components/PortCard";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/** Base palette colors per basket leg, in order. */
const LEG_COLORS = ["#0000FF", "#3C8AFF", "#FEA8CD", "#FFD12F", "#B6F569"];
const WALLETS: [IconName, string][] = [
  ["w-coinbase", "Base Account"],
  ["w-metamask", "MetaMask"],
  ["w-rabby", "Rabby"],
  ["w-rainbow", "Rainbow"],
  ["w-walletconnect", "WalletConnect"],
];

function TokenLogo({ t, size = 40 }: { t?: TokenizedStock; size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      {t?.icon_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.icon_url} alt="" />
      ) : (
        <span className="num" style={{ fontSize: size * 0.32 }}>
          {t?.symbol.slice(0, 2) ?? "?"}
        </span>
      )}
    </span>
  );
}

export default async function Home() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  const basket = parseBasket();
  let tokens: TokenizedStock[] = [];
  let all: TokenizedStock[] = [];
  let peg: PegHealth[] = [];
  let basketError: string | undefined;
  try {
    tokens = await resolveSymbols(basket.map((b) => b.symbol));
    [all, peg] = await Promise.all([listTokenizedStocks(), getPegHealth(tokens)]);
  } catch (e) {
    basketError = (e as Error).message;
  }
  const legs = basket.map((b, i) => ({
    ...b,
    token: tokens[i],
    peg: peg.find((p) => p.symbol === tokens[i]?.symbol),
    color: LEG_COLORS[i % LEG_COLORS.length],
  }));
  const targets = legs.map((l) => `${l.symbol} ${Math.round(l.weightBps / 100)}`).join(" · ");

  const tickerItems = legs.map((l) => (
    <span key={l.symbol} className="mq-i">
      <TokenLogo t={l.token} size={28} />
      {l.symbol}
      {l.token?.nav_price ? <span className="num">${l.token.nav_price.toFixed(2)}</span> : null}
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{Math.round(l.weightBps / 100)}%</span>
    </span>
  ));
  tickerItems.push(
    <span key="tag" className="mq-i">
      <Icon name="ph-sparkle" size={18} />
      Own what the AI owns
    </span>,
  );
  const infoItems = [
    <span key="a" className="mq-i">
      <Icon name="ph-shield-check" size={20} />
      Exact approvals, never infinite
    </span>,
    <span key="b" className="mq-i">
      <Icon name="ph-lightning" size={20} />
      Routed via o1 Exchange
    </span>,
    <span key="c" className="mq-i">
      <Icon name="ph-broom" size={20} />
      Sweep your dust into stocks
    </span>,
    <span key="d" className="mq-i">
      <Icon name="ph-wallet" size={20} />
      Self-custody: tokens land in your wallet
    </span>,
    <span key="e" className="mq-i">
      <Icon name="net-base" size={18} />
      Built on Base · every tx checkable onchain
    </span>,
  ];
  const track = (items: ReactNode[], hidden = false) => (
    <div className="mq-track" aria-hidden={hidden || undefined}>
      {items}
      {items}
    </div>
  );

  return (
    <main>
      <div className="glowbg" style={{ position: "relative" }}>
        <div className="gridbg" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
        <header className="wrap" style={{ position: "relative", textAlign: "center", paddingTop: 96, paddingBottom: 48 }}>
          <div
            className="r1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--line-hi)",
              background: "rgba(10,11,13,.03)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <span className="live" />
            Tokenized stocks <Icon name="net-base" size={14} /> on Base
          </div>
          <h1 className="disp r2" style={{ fontSize: "clamp(46px,7.4vw,84px)", lineHeight: 1.02, margin: "22px 0 0" }}>
            Own what the AI <em>owns.</em>
          </h1>
          <p className="r3 muted" style={{ maxWidth: 620, margin: "22px auto 0", fontSize: 19 }}>
            An AI agent runs a basket of tokenized stocks fully onchain. Copy its bag from $5 in one tx. Self-custody: the
            tokens land in your wallet.
          </p>
          <div className="r4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
            <a href="#buy" className="btn btn-blue">
              Copy the Agent from $5
            </a>
            <a href="/dust" className="btn btn-ghost">
              <Icon name="ph-broom" size={18} />
              Sweep your dust
            </a>
          </div>
          <div
            className="r4"
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              alignItems: "center",
              marginTop: 28,
              color: "var(--g60)",
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span>Works with</span>
            <span style={{ display: "inline-flex", gap: 8 }}>
              {WALLETS.map(([icon, name]) => (
                <span
                  key={name}
                  title={name}
                  role="img"
                  aria-label={name}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    border: "1px solid var(--line)",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={icon} size={22} />
                </span>
              ))}
            </span>
          </div>
        </header>

        <section className="wrap r4" style={{ position: "relative", paddingBottom: 24 }}>
          <div className="card pad" style={{ padding: 36 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: "rgba(0,0,255,.12)",
                  color: "var(--blue)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                <Icon name="ph-robot" size={28} />
              </span>
              <div>
                <div className="eyebrow">The Agent&apos;s basket · tokenized stocks</div>
                <div className="disp" style={{ fontSize: 28, marginTop: 4 }}>
                  {legs.length} stocks, one tx
                </div>
              </div>
            </div>

            {basketError && (
              <p style={{ color: "var(--red)", fontSize: 14, marginTop: 20 }}>Basket unavailable: {basketError}</p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
                gap: 24,
                marginTop: 28,
                paddingTop: 24,
                borderTop: "1px solid var(--line)",
              }}
            >
              {legs.map((l) => (
                <div key={l.symbol} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <TokenLogo t={l.token} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, gap: 8 }}>
                      <span>{l.symbol}</span>
                      <span className="num">{l.token?.nav_price ? `$${l.token.nav_price.toFixed(2)}` : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--g60)", gap: 8 }}>
                      <span>{Math.round(l.weightBps / 100)}% of basket · NAV</span>
                      <PegChip peg={l.peg} compact />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bar" aria-hidden="true" style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 22, gap: 3 }}>
              {legs.map((l) => (
                <span key={l.symbol} style={{ flex: l.weightBps, background: l.color }} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="mq" role="marquee" aria-label="Basket tokens and how Stock Port works">
        <div className="mq-band mq-b">
          {track(infoItems)}
          {track(infoItems, true)}
        </div>
        <div className="mq-band mq-a">
          {track(tickerItems)}
          {track(tickerItems, true)}
        </div>
      </div>

      <section id="buy" className="wrap" style={{ paddingTop: 64, paddingBottom: 32, scrollMarginTop: 80 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            gap: 24,
            alignItems: "start",
          }}
        >
          <PortCard geoBlocked={geoBlocked} />

          <div style={{ display: "grid", gap: 24 }}>
          <Guardrails />
          <div className="card pad" style={{ padding: 36 }}>
            <div className="eyebrow">How the basket works</div>
            <div className="disp" style={{ fontSize: 28, lineHeight: 1.2, marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <span className="logo" style={{ width: 36, height: 36, background: "var(--blue)", color: "#fff" }}>
                <Icon name="ph-scales" size={18} />
              </span>
              <span>
                Simple rules, <em>in public.</em>
              </span>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
              <div className="rule">
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="ph-scales" size={18} />
                  Targets
                </span>
                <span className="num" style={{ fontSize: 14, textAlign: "right" }}>
                  {targets}
                </span>
              </div>
              <div className="rule">
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="ph-lightning" size={18} />
                  Route
                </span>
                <span className="num" style={{ fontSize: 14, textAlign: "right" }}>
                  o1 Exchange, Aerodrome fallback
                </span>
              </div>
              <div className="rule">
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="ph-shield-check" size={18} />
                  Approvals
                </span>
                <span className="num" style={{ fontSize: 14, textAlign: "right" }}>
                  Exact amount only
                </span>
              </div>
            </div>
            <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--g80)", marginTop: 18 }}>
              <Icon name="ph-receipt" size={16} />
              Every tx carries the Stock Port Builder Code, so anyone can verify it.
            </p>
          </div>
          </div>
        </div>
      </section>

      {all.length > 0 && (
        <section className="wrap" style={{ paddingTop: 40, paddingBottom: 16 }}>
          <StockRadar all={all} basket={basket.map((b) => b.symbol)} peg={peg} />
        </section>
      )}

      <section className="wrap" style={{ paddingTop: 72, paddingBottom: 48, textAlign: "center" }}>
        <h2 className="disp" style={{ fontSize: "clamp(36px,5vw,54px)", lineHeight: 1.05, margin: 0 }}>
          Three steps. <em>Non-custodial, end to end.</em>
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: 20,
            marginTop: 52,
            textAlign: "left",
          }}
        >
          {(
            [
              ["ph-chart-line-up", "Pick an amount", "From $5 in USDC, or sweep your dust first. The basket mix is set by the Agent."],
              ["ph-arrows-left-right", "You copy the bag", "One review, one signature. Tokenized stocks go straight to your wallet."],
              ["ph-eye", "Verify onchain", "Every tx is tagged with our Builder Code and visible on Basescan. Don't trust, verify."],
            ] as [IconName, string, string][]
          ).map(([icon, title, body]) => (
            <div key={title} className="card" style={{ padding: 28 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  border: "1px solid var(--line-hi)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--blue)",
                }}
              >
                <Icon name={icon} size={22} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 19, marginTop: 18 }}>{title}</div>
              <div style={{ color: "var(--g60)", marginTop: 6, fontSize: 15 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="mbar-pad" />
      <div className="mbar">
        <a href="#buy" className="btn btn-blue">
          Copy the Agent from $5
        </a>
      </div>
    </main>
  );
}
