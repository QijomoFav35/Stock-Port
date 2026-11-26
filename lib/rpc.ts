/**
 * Where RPC calls go.
 * - Server: BASE_RPC_URL (e.g. an Alchemy Base mainnet URL with its key). Server-only, never sent to the browser.
 *   Falls back to the public RPC (rate-limited) when unset.
 * - Browser: our own /api/rpc proxy, which forwards read-only methods to BASE_RPC_URL. So the key never
 *   appears in the page source, the JS bundle or the network tab.
 * Wallet txs don't use this: the user's wallet sends them through its own RPC.
 */
export function rpcUrl(): string | undefined {
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return process.env.BASE_RPC_URL || undefined;
}
