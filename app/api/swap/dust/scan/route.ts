/**
 * POST /api/swap/dust/scan   Body: { owner }
 * Lists the owner's small ERC-20 balances on Base that Dust to Stocks can sweep.
 * Under /api/swap so the middleware's US block (451) applies.
 *
 * Like Rabby's Convert Dust, tokens with no market price are hidden (mostly spam airdrops).
 * USDC and tokenized stocks are excluded: USDC is what we sweep into, stocks are what we buy.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { formatUnits, getAddress } from "viem";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import { DUST_MAX_USD, USDC_BASE } from "@/lib/constants";
import { getTokenBalances, getTokenMetadata, getUsdPrices } from "@/lib/alchemy";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";

export const dynamic = "force-dynamic";

const Body = z.object({ owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

export type DustToken = {
  token: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  raw: string;
  amount: string;
  priceUsd: number;
  valueUsd: number;
};
export type DustScan = { tokens: DustToken[]; hiddenUnpriced: number };

export async function POST(req: NextRequest) {
  if (isTradingBlocked(req.headers.get(GEO_HEADER))) {
    return NextResponse.json({ error: "geo_blocked" }, { status: 451 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const owner = getAddress(parsed.data.owner);

  try {
    const [balances, stocks] = await Promise.all([getTokenBalances(owner), listTokenizedStocks().catch(() => [])]);
    const skip = new Set([USDC_BASE.toLowerCase(), ...stocks.map((s) => s.contract_address.toLowerCase())]);
    const held = balances.filter((b) => !skip.has(b.token.toLowerCase())).slice(0, 100);

    const [prices, metas] = await Promise.all([
      getUsdPrices(held.map((b) => b.token)),
      getTokenMetadata(held.map((b) => b.token)),
    ]);

    let hiddenUnpriced = 0;
    const tokens: DustToken[] = [];
    held.forEach((b, i) => {
      const meta = metas[i];
      const price = prices.get(b.token);
      if (!price || meta?.decimals == null || !meta.symbol) {
        hiddenUnpriced++;
        return;
      }
      const amount = formatUnits(b.raw, meta.decimals);
      const valueUsd = Number(amount) * price;
      if (valueUsd < 0.01 || valueUsd > DUST_MAX_USD) return;
      tokens.push({
        token: b.token,
        symbol: meta.symbol,
        name: meta.name ?? meta.symbol,
        decimals: meta.decimals,
        logo: meta.logo ?? undefined,
        raw: b.raw.toString(),
        amount,
        priceUsd: price,
        valueUsd,
      });
    });
    tokens.sort((a, b) => b.valueUsd - a.valueUsd);
    return NextResponse.json({ tokens, hiddenUnpriced } satisfies DustScan);
  } catch (e) {
    return NextResponse.json({ error: "scan_failed", message: (e as Error).message }, { status: 502 });
  }
}
