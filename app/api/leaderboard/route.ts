/** GET /api/leaderboard: basket and stock moves over 24h and 7d from Chainlink NAV history (lib/leaderboard.ts). */
import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lb = await getLeaderboard();
    return NextResponse.json(lb, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=900" } });
  } catch (e) {
    return NextResponse.json({ error: "leaderboard_failed", message: (e as Error).message }, { status: 502 });
  }
}
