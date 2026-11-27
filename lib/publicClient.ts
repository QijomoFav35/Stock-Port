import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { rpcUrl } from "@/lib/rpc";

/**
 * Server: BASE_RPC_URL first, then the public Base RPC if the key is refused, rate-limited or down.
 * Browser: our /api/rpc proxy (which has the same fallback).
 */
const primary = rpcUrl();
export const publicClient = createPublicClient({
  chain: base,
  transport:
    typeof window === "undefined" && primary ? fallback([http(primary), http("https://mainnet.base.org")]) : http(primary),
});
