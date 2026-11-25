/** GET /api/guard/stats: public Loan Guard numbers (onchain) plus the keeper's recent Agent log. */
import { NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { LOAN_GUARD, loanGuardAbi } from "@/lib/loanGuard";
import { keeperLog, listGuardedUsers } from "@/lib/guardKeeper";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!LOAN_GUARD) return NextResponse.json({ deployed: false });
  try {
    const [totalRepaid, protectCount] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: LOAN_GUARD, abi: loanGuardAbi, functionName: "totalRepaid" },
        { address: LOAN_GUARD, abi: loanGuardAbi, functionName: "protectCount" },
      ],
    });
    const users = await listGuardedUsers();
    const log = keeperLog().slice(0, 20).map((r) => ({
      ...r,
      entries: r.entries.map((e) => ({ ...e, user: `${e.user.slice(0, 6)}…${e.user.slice(-4)}` })),
    }));
    return NextResponse.json(
      { deployed: true, address: LOAN_GUARD, guarded: users.length, totalRepaid: String(totalRepaid), protectCount: Number(protectCount), log },
      { headers: { "cache-control": "public, max-age=30" } },
    );
  } catch (e) {
    return NextResponse.json({ error: "stats_failed", message: (e as Error).message }, { status: 502 });
  }
}
