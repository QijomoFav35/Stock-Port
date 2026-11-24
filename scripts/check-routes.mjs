// Checks that every basket stock can actually be bought with USDC on Base, through o1 and through 0x.
// Nothing is signed or sent. Run from the project folder:
//   npm run check-routes                 (uses a $5 test split and a placeholder wallet address)
//   npm run check-routes -- 0xYourWallet 20
// Keys come from .env.local (O1_API_KEY, ZEROX_API_KEY). A missing key just skips that provider.

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

async function tryO1(token, usdc) {
  const key = process.env.O1_API_KEY;
  if (!key) return "skipped (no O1_API_KEY)";
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
  const unsignedType = typeof body.transactions[0].unsigned;
  return `OK (${body.transactions.length} tx${permit2}, unsigned is ${unsignedType})`;
}

async function try0x(token, usdc, decimals, nav) {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return "skipped (no ZEROX_API_KEY)";
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
  const [o1, zx] = await Promise.all([
    tryO1(s.contract_address, usdc).catch((e) => `FAIL ${e.message}`),
    try0x(s.contract_address, usdc, Number(s.decimals), s.nav_price).catch((e) => `FAIL ${e.message}`),
  ]);
  if (o1.startsWith("FAIL") && zx.startsWith("FAIL")) failures++;
  console.log(`${s.symbol} (${s.contract_address}), $${usdc.toFixed(2)}`);
  console.log(`  o1: ${o1}`);
  console.log(`  0x: ${zx}\n`);
}
console.log(failures ? `${failures} stock(s) have no working route.` : "Every stock has at least one working route.");
process.exit(failures ? 1 : 0);
