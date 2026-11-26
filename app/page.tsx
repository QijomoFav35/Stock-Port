import { UNIVERSE } from "@/lib/baskets";
import { listTokenizedStocks, type TokenizedStock } from "@/lib/tokenizedStocks";
import GuardAgent from "@/components/GuardAgent";
import GatesBoard from "@/components/GatesBoard";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const WALLETS: [IconName, string][] = [
  ["w-coinbase", "Base Account"],
  ["w-metamask", "MetaMask"],
  ["w-rabby", "Rabby"],
  ["w-rainbow", "Rainbow"],
  ["w-phantom", "Phantom"],
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
  // The home page only needs the stock list for the ticker. Feature pages load their own data.
  let all: TokenizedStock[] = [];
  try {
    all = await listTokenizedStocks();
  } catch {
    all = [];
  }
  const bySymbol = new Map(all.map((t) => [t.symbol, t]));
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
            Just like an airport, but for stocks. Borrow USDC against your tokenized stocks, and Loan Guard repays before
            liquidation, even over the weekend. Every rule is enforced onchain, on Base.
          </p>
          <div className="r4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
            <a href="#routes" className="btn btn-blue">
              Explore the port
            </a>
            <a href="/borrow" className="btn btn-ghost">
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

      <section className="wrap sec" style={{ paddingBottom: 8 }}>
        <div className="gate-head">
          <h2 className="disp gate-title">
            The Guard Agent. <em>On duty now.</em>
          </h2>
          <p className="gate-sub">It watches every Aave stock loan on Base and reads the weekend before the market does.</p>
        </div>
        <GuardAgent compact />
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
              ["ph-wallet", "Connect your wallet", "Base Account, MetaMask, Coinbase Wallet, Rabby or Phantom. Your keys never leave your wallet."],
              ["ph-arrows-left-right", "Borrow and guard", "Borrow USDC against your stocks, then arm Loan Guard with a USDC reserve. Each move is one review and one signature."],
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
          Explore the port
        </a>
      </div>
    </main>
  );
}
