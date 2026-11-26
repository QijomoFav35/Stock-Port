export const metadata = {
  title: "Privacy · Stock Port",
  description: "What Stock Port collects (almost nothing) and which services see your requests.",
};

const UPDATED = "November 26, 2026";

export default function PrivacyPage() {
  return (
    <main className="wrap prose" style={{ paddingTop: 56, paddingBottom: 64, maxWidth: 760 }}>
      <div className="eyebrow">Privacy</div>
      <h1 className="disp" style={{ fontSize: "clamp(34px,5vw,52px)", lineHeight: 1.05, margin: "12px 0 0" }}>
        No accounts. <em>No tracking cookies.</em>
      </h1>
      <p className="muted">Last updated {UPDATED}.</p>

      <h2>What we don&apos;t collect</h2>
      <p>
        Stock Port has no sign-up, no passwords, no email list and no database of users. We never hold your funds or your keys. You connect
        a self-custody wallet, and every tx is signed in that wallet.
      </p>

      <h2>What is public anyway</h2>
      <p>
        Your wallet address and every tx you send are public on the Base blockchain. Anyone can see them on Basescan, with or without Stock
        Port. Txs sent from this site carry our Builder Code, which marks them as made through Stock Port.
      </p>

      <h2>What our servers see</h2>
      <ul>
        <li>
          <b>Your IP address</b>, to check your country, because tokenized stocks are not available in the US, UK or other restricted
          regions. On our host we look it up with ipinfo.io. We don&apos;t store it beyond a short in-memory cache.
        </li>
        <li>
          <b>Your wallet address and amounts</b>, when you ask for a quote or a borrow preview, so we can build the tx.
        </li>
        <li>
          <b>Standard server logs</b> (time, page, status) kept by our host for debugging and abuse prevention.
        </li>
      </ul>

      <h2>Services that handle your requests</h2>
      <p>To quote, route and read onchain data, requests go to these providers. Each has its own privacy policy.</p>
      <ul>
        <li>o1 Exchange, Aerodrome and 0x (swap quotes; they see the wallet address and amount)</li>
        <li>Aave (lending market data), Chainlink (NAV feeds), Coinbase (tokenized stock list)</li>
        <li>ipinfo.io (country check)</li>
        <li>Your wallet provider, such as Base Account, MetaMask, Coinbase Wallet, Rabby or Phantom</li>
      </ul>

      <h2>Cookies and analytics</h2>
      <p>
        We set one small cookie, <code>sp_geo_blocked</code>, that only says whether trading is available in your region. Your wallet may
        store its connection in your browser. If page analytics are on, we use a cookieless tool (Umami or Plausible) that counts visits
        without personal data or cross-site tracking.
      </p>

      <h2>Not investment advice</h2>
      <p>
        Tokenized stocks track a reference price and grant no shareholder or voting rights. Borrowing can lead to liquidation. Loan Guard
        lowers that risk but can&apos;t remove it. Past results don&apos;t predict future ones.
      </p>
    </main>
  );
}
