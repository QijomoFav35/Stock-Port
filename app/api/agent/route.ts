/** GET /api/agent: the Guard Agent's latest run (lib/guardAgent.ts). Shared by all visitors, refreshed each minute. */
import { NextResponse } from "next/server";
import { getAgentReport } from "@/lib/guardAgent";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await getAgentReport();
    return NextResponse.json(r, { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: "agent_failed", message: logAndMask("agent", e) }, { status: 502 });
  }
}
