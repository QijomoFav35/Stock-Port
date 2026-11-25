/**
 * GET /api/guard/stats: public Loan Guard numbers, read onchain so they survive restarts and anyone can verify them.
 * Totals come from the contract, recent top-ups from each guard's lastProtect. Only the keeper's last check
 * (a liveness signal) comes from server memory.
 */
import { NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { LOAN_GUARD, loanGuardAbi } from "@/lib/loanGuard";
import { keeperLog, listGuardedUsers } from "@/lib/guardKeeper";

export const dynamic = "force-dynamic";

const mask = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
    // guards(user) = [reserve, trigger, target, weekendTrigger, lastProtect]
    const guards: readonly (readonly bigint[])[] = users.length
      ? ((await publicClient.multicall({
          allowFailure: false,
          contracts: users.map((u) => ({ address: LOAN_GUARD!, abi: loanGuardAbi, functionName: "guards", args: [u] }) as const),
        })) as unknown as readonly (readonly bigint[])[])
      : [];
    const recent = guards
      .map((g, i) => ({ user: mask(users[i]), at: Number(g[4]) * 1000 }))
      .filter((r) => r.at > 0)
      .sort((a, b) => b.at - a.at)
      .slice(0, 8);
    const armed = guards.filter((g) => g[1] > 0n).length;
    const last = keeperLog()[0];
    return NextResponse.json(
      {
        deployed: true,
        address: LOAN_GUARD,
        guarded: armed,
        totalRepaid: String(totalRepaid),
        protectCount: Number(protectCount),
        recent,
        lastCheck: last ? { at: last.at, checked: last.checked, atRisk: last.atRisk } : null,
      },
      { headers: { "cache-control": "public, max-age=30" } },
    );
  } catch (e) {
    return NextResponse.json({ error: "stats_failed", message: (e as Error).message }, { status: 502 });
  }
}
