/**
 * Server-side keeper for LoanGuard. Reads every armed user from the contract, asks check(user),
 * and sends protect(user) for anyone under their trigger. protect() is permissionless and the
 * contract enforces all the rules, so the keeper key only pays gas and can't move user funds.
 *
 * Env (server only): KEEPER_PRIVATE_KEY (a fresh hot wallet with a little ETH on Base for gas).
 */
import { createWalletClient, encodeFunctionData, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { publicClient } from "@/lib/publicClient";
import { LOAN_GUARD, loanGuardAbi } from "@/lib/loanGuard";
import { DATA_SUFFIX, withBuilderCode } from "@/lib/attribution";

export type KeeperEntry = { at: number; user: Address; health: number; trigger: number; amount: string; tx?: Hash; error?: string };
export type KeeperRun = { at: number; checked: number; atRisk: number; protected: number; entries: KeeperEntry[] };

const LOG_MAX = 50;
const g = globalThis as unknown as { __guardLog?: KeeperRun[] };
export const keeperLog = () => (g.__guardLog ??= []);

export async function listGuardedUsers(): Promise<Address[]> {
  if (!LOAN_GUARD) return [];
  const n = await publicClient.readContract({ address: LOAN_GUARD, abi: loanGuardAbi, functionName: "userCount" });
  const idx = Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const res = await publicClient.multicall({
    allowFailure: false,
    contracts: idx.map((i) => ({ address: LOAN_GUARD!, abi: loanGuardAbi, functionName: "users", args: [i] }) as const),
  });
  return res as unknown as Address[];
}

export async function runKeeper(): Promise<KeeperRun> {
  if (!LOAN_GUARD) throw new Error("NEXT_PUBLIC_LOAN_GUARD_ADDRESS is not set");
  const users = await listGuardedUsers();
  const checks = await publicClient.multicall({
    allowFailure: true,
    contracts: users.map((u) => ({ address: LOAN_GUARD!, abi: loanGuardAbi, functionName: "check", args: [u] }) as const),
  });
  const run: KeeperRun = { at: Date.now(), checked: users.length, atRisk: 0, protected: 0, entries: [] };
  const pk = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
  const wallet = pk ? createWalletClient({ account: privateKeyToAccount(pk), chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) }) : undefined;

  for (const [i, c] of checks.entries()) {
    if (c.status !== "success") continue;
    const [needed, health, trigger, amount] = c.result as readonly [boolean, bigint, bigint, bigint];
    if (!needed) continue;
    run.atRisk++;
    const entry: KeeperEntry = { at: Date.now(), user: users[i], health: Number(health) / 1e18, trigger: Number(trigger) / 1e18, amount: amount.toString() };
    if (!wallet) {
      entry.error = "keeper key not set";
    } else {
      try {
        const data = encodeFunctionData({ abi: loanGuardAbi, functionName: "protect", args: [users[i]] });
        const hash = await wallet.sendTransaction({ to: LOAN_GUARD, data: DATA_SUFFIX ? withBuilderCode(data) : data });
        const r = await publicClient.waitForTransactionReceipt({ hash });
        entry.tx = hash;
        if (r.status === "success") run.protected++;
        else entry.error = "reverted";
      } catch (e) {
        entry.error = (e as Error).message.slice(0, 160);
      }
    }
    run.entries.push(entry);
  }
  const log = keeperLog();
  log.unshift(run);
  log.length = Math.min(log.length, LOG_MAX);
  return run;
}
