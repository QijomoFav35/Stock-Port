// Which tokenized stocks can actually be bought right now? Checks EVERY stock in the Coinbase
// Tokenized Stocks API, not just the basket. Nothing is signed or sent.
//   Aerodrome: USDC in the deepest USDC pool on our router's factory (and on the other CL factory).
//   o1: asks for a $5 buy order when O1_API_KEY is in .env.local (no tx is sent).
// Run from the project folder:
//   npm run check-universe
// Prints a table, best liquidity first. Paste it back so baskets are built from stocks that trade.
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = process.env.AERODROME_ROUTER ?? "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";
const OTHER_FACTORY = "0x9CB220581b91b0C83223012FE69688b92aD07a76";
const SPACINGS = [1, 10, 50, 100, 200, 2000];
const MIN_USDC = 1000;

const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const factoryAbi = parseAbi([
  "function getPool(address,address,int24) view returns (address)",
  "function tickSpacings() view returns (int24[])",
]);
const routerAbi = parseAbi(["function factory() view returns (address)"]);

async function listStocks() {
  const out = [];
  let token;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: "500" });
    if (token) q.set("page_token", token);
    const res = await fetch("https://api.coinbase.com/v1/tokenized-stocks?" + q);
    if (!res.ok) throw new Error("Tokenized Stocks API " + res.status);
    const page = await res.json();
    out.push(...page.tokens);
    token = page.next_page_token;
    if (!token) break;
  }
  return out;
}

const spacingCache = new Map();
async function spacings(factory) {
  if (!spacingCache.has(factory)) {
    spacingCache.set(
      factory,
      await client
        .readContract({ address: factory, abi: factoryAbi, functionName: "tickSpacings" })
        .then((t) => t.map(Number))
        .catch(() => SPACINGS),
    );
  }
  return spacingCache.get(factory);
}

/** USDC held by the deepest USDC/token pool on this factory (0 if none). */
async function bestPoolUsdc(factory, token) {
  let best = 0;
  for (const ts of await spacings(factory)) {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [USDC, token, ts] });
    if (/^0x0{40}$/i.test(pool)) continue;
    const bal = Number(await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [pool] })) / 1e6;
    if (bal > best) best = bal;
  }
  return best;
}

async function o1Ok(token) {
  const key = process.env.O1_API_KEY;
  if (!key) return "-";
  try {
    const res = await fetch((process.env.O1_API_BASE_URL ?? "https://api.o1.exchange") + "/api/v2/order", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        networkId: 8453,
        signerAddress: process.argv[2] ?? "0x000000000000000000000000000000000000dEaD",
        tokenAddress: token,
        quoteTokenAddress: USDC,
        uiAmount: "5",
        direction: "buy",
        slippageBps: 300,
        mevProtection: false,
      }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok && body?.success !== false && body?.transactions?.length ? "yes" : "no (" + res.status + ")";
  } catch {
    return "error";
  }
}

const money = (n) => (n ? "$" + Math.round(n).toLocaleString() : "-");

const factory = await client.readContract({ address: ROUTER, abi: routerAbi, functionName: "factory" });
const stocks = await listStocks();
console.log("Checking " + stocks.length + " tokenized stocks. This takes a minute or two.\n");

const rows = [];
for (const s of stocks) {
  const [mine, other, o1] = await Promise.all([
    bestPoolUsdc(factory, s.contract_address).catch(() => 0),
    bestPoolUsdc(OTHER_FACTORY, s.contract_address).catch(() => 0),
    o1Ok(s.contract_address),
  ]);
  rows.push({ symbol: s.symbol, nav: s.nav_price, mine, other, o1 });
  process.stdout.write(".");
}
console.log("\n");
rows.sort((a, b) => Math.max(b.mine, b.other) - Math.max(a.mine, a.other));

const pad = (v, n) => String(v).padEnd(n);
console.log(pad("STOCK", 10) + pad("NAV", 11) + pad("OUR POOL", 13) + pad("OTHER POOL", 13) + "O1 $5 BUY");
for (const r of rows) {
  console.log(
    pad(r.symbol, 10) + pad(r.nav ? "$" + r.nav.toFixed(2) : "-", 11) + pad(money(r.mine), 13) + pad(money(r.other), 13) + r.o1,
  );
}
const buyable = rows.filter((r) => r.mine >= MIN_USDC || r.o1 === "yes");
console.log("\nBuyable now (our pool has $" + MIN_USDC + "+ USDC, or o1 quotes it): " + buyable.length);
console.log(buyable.map((r) => r.symbol).join(", ") || "none");
