/**
 * POST /api/guard/keeper: one keeper pass over every Loan Guard position.
 * Call it every few minutes from a Render Cron Job (or any scheduler) with
 *   Authorization: Bearer $KEEPER_CRON_SECRET
 */
import { NextResponse, type NextRequest } from "next/server";
import { KeeperBusyError, runKeeper } from "@/lib/guardKeeper";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.KEEPER_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runKeeper());
  } catch (e) {
    if (e instanceof KeeperBusyError) return NextResponse.json({ error: "busy", message: e.message }, { status: 409 });
    return NextResponse.json({ error: "keeper_failed", message: (e as Error).message }, { status: 500 });
  }
}
