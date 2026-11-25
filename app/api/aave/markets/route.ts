/**
 * GET /api/aave/markets: live collateral factors, USDC borrow APY and USDC left to borrow on the
 * Aave V4 "Coinbase Stocks" Spoke on Base, from Aave's public GraphQL API (no key). Cached 5 min.
 */
import { NextResponse } from "next/server";
import { AAVE_API, AAVE_SPOKE } from "@/lib/aave";

export const dynamic = "force-dynamic";

type Row = {
  onChainId: string;
  canBorrow: boolean;
  canUseAsCollateral: boolean;
  asset: { underlying: { address: string; info: { symbol: string } } };
  settings: { collateralFactor: { value: string } };
  summary: { borrowable: { amount: { value: string } }; borrowApy: { value: string } };
};

const QUERY = `{ reserves(request:{query:{spoke:{address:"${AAVE_SPOKE}",chainId:8453}}, filter:ALL, orderBy:{assetName:ASC}}){
  onChainId canBorrow canUseAsCollateral
  asset{ underlying{ address info{ symbol } } }
  settings{ collateralFactor{ value } }
  summary{ borrowable{ amount{ value } } borrowApy{ value } }
} }`;

export async function GET() {
  try {
    const res = await fetch(AAVE_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      next: { revalidate: 300 },
    } as RequestInit);
    const body = (await res.json()) as { data?: { reserves: Row[] }; errors?: { message: string }[] };
    if (!res.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? `Aave API ${res.status}`);
    const reserves = body.data.reserves.map((r) => ({
      reserveId: r.onChainId,
      symbol: r.asset.underlying.info.symbol,
      token: r.asset.underlying.address,
      collateralFactor: Number(r.settings.collateralFactor.value),
      canBorrow: r.canBorrow,
      canUseAsCollateral: r.canUseAsCollateral,
      borrowable: Number(r.summary.borrowable.amount.value),
      borrowApy: Number(r.summary.borrowApy.value),
    }));
    return NextResponse.json({ reserves }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=900" } });
  } catch (e) {
    return NextResponse.json({ error: "aave_api_failed", message: (e as Error).message }, { status: 502 });
  }
}
