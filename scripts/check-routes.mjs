// Checks that every basket stock can actually be bought with USDC on Base. Nothing is signed or sent.
//   Aerodrome (default, no key): deepest USDC pool on the router's own factory, and a live price feed.
//   0x / o1 (optional): only checked when ZEROX_API_KEY / O1_API_KEY are in .env.local.
// Run from the project folder:
//   npm run check-routes                 (uses a $5 test split and a placeholder wallet address)
//   npm run check-routes -- 0xYourWallet 20
import { createPublicClient, http, parseAbi, parseTransaction } from "viem";
import { base } from "viem/chains";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHAIN = 8453;
const args = process.argv.slice(2).filter((a) => a !== "--details");
const showDetails = process.argv.includes("--details");
const taker = args[0]; // optional; 0x prices without one
const usd = Number(args[1] ?? 5);
const basket = (process.env.NEXT_PUBLIC_BASKET ?? "NVDAc:3400,GOOGLc:3300,METAc:3300")
  .split(",")
  .map((p) => {
    const [symbol, w] = p.trim().split(":");
    return { symbol, weightBps: Number(w) };
  });

const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined) });
const ROUTER = process.env.AERODROME_ROUTER ?? "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";
// Glacier's pools live on this other Aerodrome CL factory. Shown for comparison only: our router can't use them.
const OTHER_FACTORY = "0x9CB220581b91b0C83223012FE69688b92aD07a76";
const FEEDS = {
  NVDAc: "0x04689a41629776563E6822F76f2e57D148d28513",
  GOOGLc: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  METAc: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  AAPLc: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  MSFTc: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  TSLAc: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
  AMZNc: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
};
const SPACINGS = [1, 10, 50, 100, 200, 2000];
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const factoryAbi = parseAbi([
  "function getPool(address,address,int24) view returns (address)",
  "function tickSpacings() view returns (int24[])",
]);
const routerAbi = parseAbi(["function factory() view returns (address)"]);

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

async function listStocks() {
  const out = [];
  let token;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: "500" });
    if (token) q.set("page_token", token);
    const res = await fetch(`https://api.coinbase.com/v1/tokenized-stocks?${q}`);
    if (!res.ok) throw new Error(`Tokenized Stocks API ${res.status}`);
    const page = await res.json();
    out.push(...page.tokens);
    token = page.next_page_token;
    if (!token) break;
  }
  return out;
}

async function pools(factory, token) {
  const spacings = await client
    .readContract({ address: factory, abi: factoryAbi, functionName: "tickSpacings" })
    .then((t) => t.map(Number))
    .catch(() => SPACINGS);
  const out = [];
  for (const ts of spacings) {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [USDC, token, ts] });
    if (/^0x0{40}$/i.test(pool)) continue;
    const bal = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [pool] });
    out.push({ pool, ts, usdc: Number(bal) / 1e6 });
  }
  return out.sort((a, b) => b.usdc - a.usdc);
}

async function tryAerodrome(symbol, token, factory) {
  const feed = FEEDS[symbol];
  if (!feed) return "FAIL no price feed configured";
  const [mine, other, round] = await Promise.all([
    pools(factory, token),
    pools(OTHER_FACTORY, token).catch(() => []),
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const ageH = (Date.now() / 1000 - Number(round[3])) / 3600;
  const otherBest = other[0] ? ` | other factory's best pool: $${Math.round(other[0].usdc).toLocaleString()}` : "";
  const best = mine[0];
  if (!best || best.usdc < 1000) {
    return `FAIL no pool with $1,000+ USDC on the router's factory${otherBest}`;
  }
  return `OK pool ${best.pool} (tickSpacing ${best.ts}), $${Math.round(best.usdc).toLocaleString()} USDC, feed $${(Number(round[1]) / 1e8).toFixed(2)} (${ageH.toFixed(1)}h old)${otherBest}`;
}

async function tryO1(token, usdc) {
  const key = process.env.O1_API_KEY;
  if (!key) return "skipped (no O1_API_KEY, optional)";
  const res = await fetch(`${process.env.O1_API_BASE_URL ?? "https://api.o1.exchange"}/api/v2/order`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      networkId: CHAIN,
      signerAddress: taker ?? "0x000000000000000000000000000000000000dEaD",
      tokenAddress: token,
      quoteTokenAddress: USDC,
      uiAmount: usdc.toFixed(6),
      direction: "buy",
      slippageBps: 300,
      mevProtection: false,
    }),
  });
  const body = await json(res);
  if (!res.ok || body?.success === false || !body?.transactions?.length) {
    return `FAIL ${res.status} ${JSON.stringify(body).slice(0, 160)}`;
  }
  const permit2 = body.transactions.some((t) => t.permit2) ? ", uses Permit2" : "";
  // Describe each step so we can see what o1 asks the wallet to do (shown only with --details).
  const steps = body.transactions.map((t, i) => {
    let u = t.unsigned ?? {};
    if (typeof u === "string") {
      const tx = parseTransaction(u);
      u = { to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: tx.chainId };
    }
    const data = String(u.data ?? "0x");
    const sel = data.slice(0, 10);
    let what = `call ${sel}`;
    if (sel === "0x095ea7b3") {
      const spender = "0x" + data.slice(34, 74);
      const amount = BigInt("0x" + data.slice(74, 138));
      what = `APPROVE spender ${spender} amount ${amount === 2n ** 256n - 1n ? "UNLIMITED" : `${Number(amount) / 1e6} USDC`}`;
    }
    const usdcTarget = String(u.to ?? "").toLowerCase() === USDC.toLowerCase() ? " (USDC contract)" : "";
    return `      step ${i + 1}: to ${u.to}${usdcTarget} | ${what} | value ${u.value ?? 0} | chain ${u.chainId ?? "?"}${t.permit2 ? " | Permit2 signature" : ""}`;
  });
  return `OK (${body.transactions.length} tx${permit2})${showDetails ? "\n" + steps.join("\n") : ""}`;
}

async function try0x(token, usdc, decimals, nav) {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return "skipped (no ZEROX_API_KEY, optional backup)";
  const q = new URLSearchParams({
    chainId: String(CHAIN),
    sellToken: USDC,
    buyToken: token,
    sellAmount: String(Math.round(usdc * 1e6)),
  });
  if (taker) q.set("taker", taker);
  const res = await fetch(`https://api.0x.org/swap/allowance-holder/price?${q}`, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
  });
  const body = await json(res);
  if (!res.ok) return `FAIL ${res.status} ${JSON.stringify(body).slice(0, 160)}`;
  if (!body.liquidityAvailable) return "FAIL no liquidity";
  const shares = Number(body.buyAmount) / 10 ** decimals;
  const price = usdc / shares;
  const vsRef = nav ? ` (${(((price - nav) / nav) * 100).toFixed(2)}% vs reference $${nav.toFixed(2)})` : "";
  return `OK ${shares.toFixed(6)} shares at ~$${price.toFixed(2)}${vsRef}`;
}

const routerFactory = await client.readContract({ address: ROUTER, abi: routerAbi, functionName: "factory" });
console.log(`Aerodrome router ${ROUTER}\n  swaps through factory ${routerFactory}\n`);

const stocks = await listStocks();
console.log(`Checking a $${usd} buy split across ${basket.map((b) => b.symbol).join(", ")}\n`);
let failures = 0;
for (const leg of basket) {
  const s = stocks.find((t) => t.symbol.toLowerCase() === leg.symbol.toLowerCase());
  if (!s) {
    console.log(`${leg.symbol}: NOT FOUND in the Tokenized Stocks API`);
    failures++;
    continue;
  }
  const usdc = (usd * leg.weightBps) / 10_000;
  const [aero, o1, zx] = await Promise.all([
    tryAerodrome(leg.symbol, s.contract_address, routerFactory).catch((e) => `FAIL ${e.shortMessage ?? e.message}`),
    tryO1(s.contract_address, usdc).catch((e) => `FAIL ${e.message}`),
    try0x(s.contract_address, usdc, Number(s.decimals), s.nav_price).catch((e) => `FAIL ${e.message}`),
  ]);
  if (![aero, o1, zx].some((r) => r.startsWith("OK"))) failures++;
  console.log(`${s.symbol} (${s.contract_address}), $${usdc.toFixed(2)}`);
  console.log(`  aerodrome: ${aero}`);
  console.log(`  0x:        ${zx}`);
  console.log(`  o1:        ${o1}\n`);
}
console.log(failures ? `${failures} stock(s) have no working route.` : "Every stock has at least one working route.");
process.exit(failures ? 1 : 0);
