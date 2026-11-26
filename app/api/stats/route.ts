/** GET /api/stats: every Stock Port tx found onchain by its Builder Code (lib/usage.ts). */
import { NextResponse } from "next/server";
import { getUsage } from "@/lib/usage";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const u = await getUsage();
    return NextResponse.json(u, { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: "stats_failed", message: logAndMask("stats", e) }, { status: 502 });
  }
}
