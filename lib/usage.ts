/**
 * Public usage counter: every Stock Port tx, found onchain and verified by its Builder Code.
 *
 * How it works (no database, nothing self-reported):
 * 1. Read all logs from the contracts our txs touch (the 14 tokenized stocks, the Aave V4 spoke, LoanGuard),
 *    from STATS_FROM_BLOCK to the latest block.
 * 2. For each tx in those logs, fetch its calldata and keep it only if it carries our Builder Code (ERC-8021).
 * 3. Classify by which contract emitted logs: LoanGuard = "guard", Aave spoke = "borrow", otherwise "trade".
 *
 * Anyone can repeat this with a block explorer, so the numbers can't be faked. State lives in server memory and is
 * rebuilt from the chain after a restart.
 */
import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { AAVE_SPOKE } from "@/lib/aave";
import { LOAN_GUARD } from "@/lib/loanGuard";
import { UNIVERSE } from "@/lib/baskets";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";
import { DATA_SUFFIX, hasBuilderCode } from "@/lib/attribution";

export type UsageKind = "trade" | "borrow" | "guard";
export type UsageTx = { hash: Hex; kind: UsageKind; wallet: Address; block: number };

/** ERC-4337 EntryPoints (v0.6, v0.7). Smart wallet txs are sent by a bundler, so the wallet comes from the UserOp event. */
const ENTRYPOINTS = new Set(
  ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", "0x0000000071727De22E5E9d8BAf0edAc6f37da032"].map((a) => a.toLowerCase()),
);
/** keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"), same in v0.6 and v0.7. */
const USER_OP_EVENT = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";

const STEP = 2000n; // blocks per getLogs call
const BUDGET_MS = 8000; // max scan time per request, the rest continues on the next one

type State = {
  from: bigint;
  cursor: bigint; // next block to scan
  head: bigint;
  txs: Map<Hex, UsageTx>;
  seen: Set<Hex>; // every tx hash already checked, attributed or not
  watch?: Address[];
  running?: Promise<void>;
};
const g = globalThis as unknown as { __usage?: State };

export const STATS_FROM_BLOCK = process.env.STATS_FROM_BLOCK ? BigInt(process.env.STATS_FROM_BLOCK) : undefined;

async function watchList(): Promise<Address[]> {
  const all = await listTokenizedStocks();
  const stocks = all.filter((t) => (UNIVERSE as readonly string[]).includes(t.symbol)).map((t) => getAddress(t.contract_address));
  return [...stocks, AAVE_SPOKE, ...(LOAN_GUARD ? [LOAN_GUARD] : [])];
}

function carriesCode(input: Hex): boolean {
  if (hasBuilderCode(input)) return true;
  // Smart wallet batches: the suffix sits on the UserOp calldata inside handleOps, not at the very end.
  return !!DATA_SUFFIX && input.toLowerCase().includes(DATA_SUFFIX.slice(2).toLowerCase());
}

async function inspect(hash: Hex, emitters: Set<string>, block: bigint, st: State) {
  const tx = await publicClient.getTransaction({ hash });
  if (!carriesCode(tx.input)) return;
  let wallet: Address = tx.from;
  if (tx.to && ENTRYPOINTS.has(tx.to.toLowerCase())) {
    const rc = await publicClient.getTransactionReceipt({ hash });
    const op = rc.logs.find((l) => l.topics[0] === USER_OP_EVENT && l.topics[2]);
    if (op?.topics[2]) wallet = getAddress(`0x${op.topics[2].slice(26)}`);
  }
  const kind: UsageKind =
    LOAN_GUARD && emitters.has(LOAN_GUARD.toLowerCase()) ? "guard" : emitters.has(AAVE_SPOKE.toLowerCase()) ? "borrow" : "trade";
  st.txs.set(hash, { hash, kind, wallet, block: Number(block) });
}

async function scan(st: State) {
  const started = Date.now();
  st.watch ??= await watchList();
  st.head = await publicClient.getBlockNumber();
  let step = STEP;
  while (st.cursor <= st.head && Date.now() - started < BUDGET_MS) {
    const to = st.cursor + step - 1n > st.head ? st.head : st.cursor + step - 1n;
    const logs = await publicClient.getLogs({ address: st.watch, fromBlock: st.cursor, toBlock: to }).catch((e: unknown) => {
      if (step > 100n) return null; // provider refused the range, retry smaller
      throw e;
    });
    if (!logs) {
      step /= 2n;
      continue;
    }
    const byTx = new Map<Hex, { emitters: Set<string>; block: bigint }>();
    for (const l of logs) {
      if (!l.transactionHash || st.seen.has(l.transactionHash)) continue;
      const e = byTx.get(l.transactionHash) ?? { emitters: new Set<string>(), block: l.blockNumber ?? to };
      e.emitters.add(l.address.toLowerCase());
      byTx.set(l.transactionHash, e);
    }
    const items = [...byTx.entries()];
    for (let i = 0; i < items.length; i += 10) {
      await Promise.all(items.slice(i, i + 10).map(([h, e]) => inspect(h, e.emitters, e.block, st)));
    }
    for (const [h] of items) st.seen.add(h);
    st.cursor = to + 1n;
  }
}

export type UsageSummary = {
  configured: boolean;
  fromBlock?: number;
  scannedTo?: number;
  behind?: number;
  txs?: number;
  wallets?: number;
  byKind?: Record<UsageKind, number>;
  recent?: { hash: Hex; kind: UsageKind; wallet: string; block: number; ago: number }[];
};

const mask = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function getUsage(): Promise<UsageSummary> {
  if (STATS_FROM_BLOCK === undefined || !DATA_SUFFIX) return { configured: false };
  const fresh: State = { from: STATS_FROM_BLOCK, cursor: STATS_FROM_BLOCK, head: STATS_FROM_BLOCK, txs: new Map<Hex, UsageTx>(), seen: new Set<Hex>() };
  const st: State = (g.__usage ??= fresh);
  // One scan at a time; concurrent requests wait for the same pass.
  st.running ??= scan(st).finally(() => (st.running = undefined));
  await st.running;

  const list = [...st.txs.values()].sort((a, b) => b.block - a.block);
  const byKind: Record<UsageKind, number> = { trade: 0, borrow: 0, guard: 0 };
  for (const t of list) byKind[t.kind]++;
  const scannedTo = st.cursor - 1n;
  return {
    configured: true,
    fromBlock: Number(st.from),
    scannedTo: Number(scannedTo),
    behind: Number(st.head - scannedTo),
    txs: list.length,
    wallets: new Set(list.map((t) => t.wallet.toLowerCase())).size,
    byKind,
    // Base makes a block every 2 seconds, close enough for "how long ago".
    recent: list.slice(0, 12).map((t) => ({ hash: t.hash, kind: t.kind, wallet: mask(t.wallet), block: t.block, ago: Number(st.head - BigInt(t.block)) * 2000 })),
  };
}
