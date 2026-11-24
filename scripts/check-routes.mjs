// Checks that every basket stock can actually be bought with USDC on Base. Nothing is signed or sent.
//   Aerodrome (default, no key): pool is registered with the factory, holds USDC, price feed is live.
//   0x / o1 (optional): only checked when ZEROX_API_KEY / O1_API_KEY are in .env.local.
// Run from the project folder:
//   npm run check-routes                 (uses a $5 test split and a placeholder wallet address)
//   npm run check-routes -- 0xYourWallet 20
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHAIN = 8453;
const taker = process.argv[2] ?? "0x000000000000000000000000000000000000dEaD";
const usd = Number(process.argv[3] ?? 5);
const basket = (process.env.NEXT_PUBLIC_BASKET ?? "NVDAc:3400,GOOGLc:3300,METAc:3300")
  .split(",")
  .map((p) => {
    const [symbol, w] = p.trim().split(":");
    return { symbol, weightBps: Number(w) };
  });

const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined) });
const ROUTER = process.env.AERODROME_ROUTER ?? "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";
const FACTORY = process.env.AERODROME_CL_FACTORY ?? "0x9CB220581b91b0C83223012FE69688b92aD07a76";
const ROUTES = {
  NVDAc: { pool: "0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  GOOGLc: { pool: "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  METAc: { pool: "0xd072410fa13D242e1d53721Bcf7AF02e3455DC96", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  AAPLc: { pool: "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  MSFTc: { pool: "0x2740C0faAb738F6e346e545fDE02aEF9B1A01ee7", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  TSLAc: { pool: "0x7A33000372f3F028f074182CCb9d16cBEEfBF920", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  AMZNc: { pool: "0x532e0F46d1e528507FC9454d5847C231f23bDDf6", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
};
const poolAbi = parseAbi([
  "function tickSpacing() view returns (int24)",
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const factoryAbi = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
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

async function tryAerodrome(symbol, token) {
  const r = ROUTES[symbol];
  if (!r) return "FAIL no pool configured";
  const [ts, pf, t0, t1, usdcBal, round] = await Promise.all([
    client.readContract({ address: r.pool, abi: poolAbi, functionName: "tickSpacing" }),
    client.readContract({ address: r.pool, abi: poolAbi, functionName: "factory" }),
    client.readContract({ address: r.pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: r.pool, abi: poolAbi, functionName: "token1" }),
    client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [r.pool] }),
    client.readContract({ address: r.feed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const canon = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getPool", args: [USDC, token, ts] });
  const problems = [];
  if (pf.toLowerCase() !== FACTORY.toLowerCase()) problems.push(`pool factory is ${pf}`);
  if (canon.toLowerCase() !== r.pool.toLowerCase()) problems.push("pool not registered with factory");
  if (![t0, t1].map((a) => a.toLowerCase()).includes(token.toLowerCase())) problems.push("pool holds a different token");
  const ageH = (Date.now() / 1000 - Number(round[3])) / 3600;
  const info = `tickSpacing ${ts}, $${(Number(usdcBal) / 1e6).toLocaleString()} USDC in pool, feed $${(Number(round[1]) / 1e8).toFixed(2)} (${ageH.toFixed(1)}h old)`;
  return problems.length ? `FAIL ${problems.join("; ")} | ${info}` : `OK ${info}`;
}

async function tryO1(token, usdc) {
  const key = process.env.O1_API_KEY;
  if (!key) return "skipped (no O1_API_KEY, optional)";
  const res = await fetch(`${process.env.O1_API_BASE_URL ?? "https://api.o1.exchange"}/api/v2/order`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      networkId: CHAIN,
      signerAddress: taker,
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
  return `OK (${body.transactions.length} tx${permit2})`;
}

async function try0x(token, usdc, decimals, nav) {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return "skipped (no ZEROX_API_KEY, optional backup)";
  const q = new URLSearchParams({
    chainId: String(CHAIN),
    sellToken: USDC,
    buyToken: token,
    sellAmount: String(Math.round(usdc * 1e6)),
    taker,
  });
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

const routerFactory = await client
  .readContract({ address: ROUTER, abi: routerAbi, functionName: "factory" })
  .catch((e) => `error: ${e.shortMessage ?? e.message}`);
const routerOk = String(routerFactory).toLowerCase() === FACTORY.toLowerCase();
console.log(`Aerodrome router ${ROUTER}\n  factory ${routerFactory} ${routerOk ? "(matches)" : `(DOES NOT MATCH ${FACTORY})`}\n`);

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
    tryAerodrome(leg.symbol, s.contract_address).catch((e) => `FAIL ${e.shortMessage ?? e.message}`),
    tryO1(s.contract_address, usdc).catch((e) => `FAIL ${e.message}`),
    try0x(s.contract_address, usdc, Number(s.decimals), s.nav_price).catch((e) => `FAIL ${e.message}`),
  ]);
  if (![aero, o1, zx].some((r) => r.startsWith("OK"))) failures++;
  console.log(`${s.symbol} (${s.contract_address}), $${usdc.toFixed(2)}`);
  console.log(`  aerodrome: ${aero}`);
  console.log(`  0x:        ${zx}`);
  console.log(`  o1:        ${o1}\n`);
}
if (!routerOk) console.log("WARNING: the Aerodrome router doesn't point at the expected factory. Don't buy until this is fixed.");
console.log(failures ? `${failures} stock(s) have no working route.` : "Every stock has at least one working route.");
process.exit(failures || !routerOk ? 1 : 0);
