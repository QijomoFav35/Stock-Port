/**
 * GET /api/autopilot: the AutoPilot agent's public state. Its address (users pick it in setPilot),
 * onchain counts, and its recent reasoning log. Pass ?user=0x… to get only that wallet's lines.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isAddress, isAddressEqual, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { AUTOPILOT, autoPilotAbi } from "@/lib/autopilotContract";
import { agentAddress, pilotLog } from "@/lib/autopilotAgent";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function GET(req: NextRequest) {
  const agent = agentAddress();
  if (!AUTOPILOT) return NextResponse.json({ live: false, agent: agent ?? null });
  const u = req.nextUrl.searchParams.get("user");
  const user = u && isAddress(u) ? (u as Address) : undefined;
  try {
    const [users, rebalances] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: AUTOPILOT, abi: autoPilotAbi, functionName: "userCount" },
        { address: AUTOPILOT, abi: autoPilotAbi, functionName: "rebalanceCount" },
      ],
    });
    const runs = pilotLog();
    const entries = runs
      .flatMap((r) => r.entries)
      .filter((e) => !user || isAddressEqual(e.user, user))
      .slice(0, 20)
      .map((e) => ({ at: e.at, user: short(e.user), action: e.action, text: e.text, tx: e.tx ?? null, error: e.error ? "failed" : null }));
    return NextResponse.json({
      live: true,
      address: AUTOPILOT,
      agent: agent ?? null,
      users: Number(users),
      rebalances: Number(rebalances),
      lastRun: runs[0]?.at ?? null,
      entries,
    });
  } catch (e) {
    return NextResponse.json({ error: "autopilot_state_failed", message: logAndMask("autopilot-state", e) }, { status: 500 });
  }
}
