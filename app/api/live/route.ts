/** GET /api/live: real tokenized-stock flows on Base in the last minutes, plus live agent checks (lib/live.ts). */
import { NextResponse } from "next/server";
import { getLiveFeed } from "@/lib/live";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feed = await getLiveFeed();
    return NextResponse.json(feed, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    return NextResponse.json({ error: "live_failed", message: logAndMask("live", e) }, { status: 502 });
  }
}
