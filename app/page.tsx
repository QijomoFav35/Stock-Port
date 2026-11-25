import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { BASKETS, UNIVERSE, getBasket } from "@/lib/baskets";
import { listTokenizedStocks, type TokenizedStock } from "@/lib/tokenizedStocks";
import { getPegHealth } from "@/lib/pegHealth";
import type { PegHealth } from "@/lib/peg";
import BasketDesk, { type StockInfo } from "@/components/BasketDesk";
import Guardrails from "@/components/Guardrails";
import StockRadar from "@/components/StockRadar";
import LeaderboardCard from "@/components/LeaderboardCard";
import BorrowCard from "@/components/BorrowCard";
import GuardCard from "@/components/GuardCard";
import GatesBoard from "@/components/GatesBoard";
import GateHead from "@/components/GateHead";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

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

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  const sp = await searchParams;
  const initial = getBasket(typeof sp.basket === "string" ? sp.basket : undefined);
  let all: TokenizedStock[] = [];
  let peg: PegHealth[] = [];
  let basketError: string | undefined;
  try {
    all = await listTokenizedStocks();
    const universe = all.filter((t) => (UNIVERSE as readonly string[]).includes(t.symbol));
    peg = await getPegHealth(universe);
  } catch (e) {
    basketError = (e as Error).message;
  }
  const bySymbol = new Map(all.map((t) => [t.symbol, t]));
  const stocks: Record<string, StockInfo> = {};
  for (const sym of UNIVERSE) {
    const t = bySymbol.get(sym);
    if (t) stocks[sym] = { symbol: sym, name: t.name, icon: t.icon_url, nav: t.nav_price, address: t.contract_address, decimals: t.decimals };
  }
  const pegBy = Object.fromEntries(peg.map((p) => [p.symbol, p]));
  const legs = UNIVERSE.map((sym) => ({ symbol: sym, token: bySymbol.get(sym) }));

  const tickerItems = legs.map((l) => (
    <span key={l.symbol} className="mq-i">
      <TokenLogo t={l.token} size={28} />
      {l.symbol}
      {l.token?.nav_price ? <span className="num">${l.token.nav_price.toFixed(2)}</span> : null}
    </span>
  ));
  tickerItems.push(
    <span key="tag" className="mq-i">
      <Icon name="ph-sparkle" size={18} />
      Stock Port · your port of entry to Tokenized Stocks
    </span>,
  );
  const infoItems = [
    <span key="a" className="mq-i">
      <Icon name="ph-shield-check" size={20} />
      Exact approvals, never infinite
    </span>,
    <span key="b" className="mq-i">
      <Icon name="ph-shield-check" size={20} />
      Live health and liquidation price on every loan
    </span>,
    <span key="c" className="mq-i">
      <Icon name="ph-lightning" size={20} />
      Deposit and borrow in one tx
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
            Now boarding <Icon name="net-base" size={14} /> on Base
          </div>
          <h1 className="disp r2" style={{ fontSize: "clamp(46px,7.4vw,84px)", lineHeight: 1.02, margin: "22px 0 0" }}>
            Your port of entry to <em>Tokenized Stocks.</em>
          </h1>
          <p className="r3 muted" style={{ maxWidth: 620, margin: "22px auto 0", fontSize: 19 }}>
            Like an airport, but for stocks. Buy, borrow, rotate and sweep tokenized stocks from one terminal on Base.
            Open 24/7, every move in one tx, self-custody all the way.
          </p>
          <div className="r4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
            <a href="#routes" className="btn btn-blue">
              Pick your route
            </a>
            <a href="#borrow" className="btn btn-ghost">
              Borrow against your stocks
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

        <section id="routes" className="wrap" style={{ position: "relative", paddingBottom: 56, scrollMarginTop: 80 }}>
          <GatesBoard />
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

      <section id="borrow" className="wrap sec">
        <GateHead
          gate="A1"
          label="Borrow"
          title={
            <>
              Borrow against your stocks. <em>Never sell.</em>
            </>
          }
          sub="USDC from Aave V4 on Base against 8 tokenized stocks. Your tokenized stocks stay as collateral, and you repay whenever you want."
        />
        <div className="sec-narrow">
          <BorrowCard geoBlocked={geoBlocked} />
        </div>
      </section>

      <section id="guard" className="wrap sec">
        <GateHead
          gate="A2"
          label="Loan Guard"
          title={
            <>
              An agent that <em>watches your loan.</em>
            </>
          }
          sub="Stocks can dump while you sleep, and NAV goes stale when TradFi closes for the weekend. Loan Guard repays from your own USDC reserve before Aave can liquidate you."
        />
        <div className="sec-narrow">
          <GuardCard />
        </div>
      </section>

      <section id="buy" className="wrap sec">
        <GateHead
          gate="B1 · B2"
          label="Buy and rotate"
          title={
            <>
              {BASKETS.length} baskets. <em>Rotate anytime.</em>
            </>
          }
          sub="No stocks yet? Buy a themed basket from $5 in USDC, then switch themes in one tx."
        />
        {basketError && <p className="err">Prices unavailable right now: {basketError}</p>}
        <BasketDesk baskets={BASKETS} initialId={initial.id} stocks={stocks} peg={pegBy} geoBlocked={geoBlocked} />
        <div className="grid-2">
          <Guardrails />
          <div className="card pad">
            <div className="eyebrow">How the basket works</div>
            <div className="disp card-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="logo" style={{ width: 36, height: 36, background: "var(--blue)", color: "#fff" }}>
                <Icon name="ph-scales" size={18} />
              </span>
              <span>
                Simple rules, <em>in public.</em>
              </span>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
              {(
                [
                  ["ph-scales", "Baskets", <>
                    <span className="num">{BASKETS.length}</span> themes · <span className="num">{UNIVERSE.length}</span> stocks
                  </>],
                  ["ph-lightning", "Route", "o1 Exchange, Aerodrome fallback"],
                  ["ph-shield-check", "Approvals", "Exact amount only"],
                ] as [IconName, string, ReactNode][]
              ).map(([icon, k, v]) => (
                <div key={k} className="rule">
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name={icon} size={18} />
                    {k}
                  </span>
                  <span style={{ fontSize: 14, textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--g80)", marginTop: 18 }}>
              <Icon name="ph-receipt" size={16} />
              Every tx carries the Stock Port Builder Code, so anyone can verify it.
            </p>
          </div>
        </div>
      </section>

      <section id="sweep" className="wrap sec">
        <GateHead
          gate="B3"
          label="Dust Sweep"
          title={
            <>
              Turn wallet dust <em>into stocks.</em>
            </>
          }
          sub="Small balances sitting in your wallet? Sweep them to USDC, then into a basket."
        />
        <div className="sec-narrow">
          <a href="/dust" className="card pad sweep-link">
            <span className="logo" style={{ width: 44, height: 44, background: "var(--yellow)", color: "var(--ink)" }}>
              <Icon name="ph-sparkle" size={20} />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>Open Dust Sweep</span>
              <span style={{ display: "block", fontSize: 14, color: "var(--g60)", marginTop: 2 }}>
                Scans your wallet, hides spam and skips anything that isn&apos;t worth the Gas.
              </span>
            </span>
            <span className="btn btn-blue btn-sm">Sweep</span>
          </a>
        </div>
      </section>

      <section id="race" className="wrap sec">
        <GateHead
          gate="B4"
          label="Basket race"
          title={
            <>
              Which basket is <em>winning this week.</em>
            </>
          }
          sub="Every basket ranked by its Chainlink NAV, read onchain."
        />
        <LeaderboardCard />
        {all.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <StockRadar all={all} basket={[...UNIVERSE]} peg={peg} />
          </div>
        )}
      </section>

      <section className="wrap sec" style={{ paddingBottom: 48 }}>
        <div className="gate-head">
          <h2 className="disp gate-title">
            How the port works. <em>Non-custodial, end to end.</em>
          </h2>
        </div>
        <div className="steps">
          {(
            [
              ["ph-wallet", "Connect your wallet", "Base Account, MetaMask, Rabby, Rainbow or WalletConnect. Your keys never leave your wallet."],
              ["ph-arrows-left-right", "Pick a route", "Borrow, guard your loan, buy a basket, rotate or sweep dust. Each move is one review and one signature."],
              ["ph-eye", "Verify onchain", "Every tx carries our Builder Code and shows up on Basescan. Don't trust, verify."],
            ] as [IconName, string, string][]
          ).map(([icon, title, body]) => (
            <div key={title} className="card pad step">
              <div className="step-icon">
                <Icon name={icon} size={22} />
              </div>
              <div className="step-title">{title}</div>
              <div className="step-body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="mbar-pad" />
      <div className="mbar">
        <a href="#routes" className="btn btn-blue">
          Pick your route
        </a>
      </div>
    </main>
  );
}
