/**
 * POST /api/autopilot/run: one AutoPilot agent pass over every user who switched Auto on.
 * Call it every few minutes from a Render Cron Job with
 *   Authorization: Bearer $KEEPER_CRON_SECRET
 */
import { NextResponse, type NextRequest } from "next/server";
import { PilotBusyError, runPilots } from "@/lib/autopilotAgent";
import { cronAuthorized } from "@/lib/cronAuth";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPilots());
  } catch (e) {
    if (e instanceof PilotBusyError) return NextResponse.json({ error: "busy", message: e.message }, { status: 409 });
    return NextResponse.json({ error: "autopilot_failed", message: logAndMask("autopilot", e) }, { status: 500 });
  }
}
