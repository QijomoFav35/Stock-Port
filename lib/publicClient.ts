import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { rpcUrl } from "@/lib/rpc";

export const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl()),
});
