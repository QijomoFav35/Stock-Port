/**
 * Share card data, read straight from Base so nobody can share a fake buy.
 * Given the tx hashes of one port (or dust sweep + port), we find the stock tokens that arrived,
 * who received them, and how much USDC that address spent in the same transactions.
 */
import { erc20Abi, formatUnits, getAddress, parseEventLogs, type Address, type Hash } from "viem";
import { publicClient } from "@/lib/publicClient";
import { USDC_BASE, USDC_DECIMALS } from "@/lib/constants";
import { listTokenizedStocks } from "@/lib/tokenizedStocks";

export type ShareLeg = { symbol: string; name: string; icon?: string; shares: number };
export type ShareData = { owner: Address; spentUsdc: number; legs: ShareLeg[] };

const HASH = /^0x[0-9a-fA-F]{64}$/;

export function parseTxParam(v: string | string[] | undefined | null): Hash[] {
  const raw = Array.isArray(v) ? v.join(",") : v ?? "";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => HASH.test(s)))].slice(0, 8) as Hash[];
}

export async function getShareData(hashes: Hash[]): Promise<ShareData | null> {
  if (!hashes.length) return null;
  const stocks = await listTokenizedStocks();
  const byAddr = new Map(stocks.map((s) => [s.contract_address.toLowerCase(), s]));
  const receipts = await Promise.all(hashes.map((hash) => publicClient.getTransactionReceipt({ hash }).catch(() => null)));
  const logs = receipts.flatMap((r) => (r && r.status === "success" ? r.logs : []));
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs });

  const stockIn = transfers.filter((t) => byAddr.has(t.address.toLowerCase()));
  if (!stockIn.length) return null;
  // The owner is whoever received the most stock transfers.
  const counts = new Map<string, number>();
  for (const t of stockIn) counts.set(t.args.to.toLowerCase(), (counts.get(t.args.to.toLowerCase()) ?? 0) + 1);
  const owner = getAddress([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  const perToken = new Map<string, bigint>();
  for (const t of stockIn) {
    if (t.args.to.toLowerCase() !== owner.toLowerCase()) continue;
    const k = t.address.toLowerCase();
    perToken.set(k, (perToken.get(k) ?? 0n) + t.args.value);
  }
  const spent = transfers
    .filter((t) => t.address.toLowerCase() === USDC_BASE.toLowerCase() && t.args.from.toLowerCase() === owner.toLowerCase())
    .reduce((s, t) => s + t.args.value, 0n);

  const legs: ShareLeg[] = [...perToken.entries()].map(([addr, raw]) => {
    const s = byAddr.get(addr)!;
    // B20 transfer amounts are raw units; shares = raw * multiplier (multiplier is de-scaled in the API).
    const shares = Number(formatUnits(raw, s.decimals)) * (s.multiplier ?? 1);
    return { symbol: s.symbol, name: s.name, icon: s.icon_url, shares };
  });
  return { owner, spentUsdc: Number(formatUnits(spent, USDC_DECIMALS)), legs };
}
