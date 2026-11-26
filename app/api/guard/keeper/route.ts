/**
 * POST /api/guard/keeper: one keeper pass over every Loan Guard position.
 * Call it every few minutes from a Render Cron Job (or any scheduler) with
 *   Authorization: Bearer $KEEPER_CRON_SECRET
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { KeeperBusyError, runKeeper } from "@/lib/guardKeeper";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

/** Constant-time compare (hash first so lengths always match). Secret must be 32+ chars, e.g. `openssl rand -hex 32`. */
function sameSecret(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.KEEPER_CRON_SECRET;
  if (!secret || secret.length < 32 || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runKeeper());
  } catch (e) {
    if (e instanceof KeeperBusyError) return NextResponse.json({ error: "busy", message: e.message }, { status: 409 });
    return NextResponse.json({ error: "keeper_failed", message: logAndMask("keeper", e) }, { status: 500 });
  }
}
