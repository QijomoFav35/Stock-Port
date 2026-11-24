import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";

/**
 * Base Account (passkey smart wallet, no extension needed) + any injected wallet (MetaMask, Rabby,
 * Coinbase Wallet extension). Note: a `dataSuffix` set here would NOT reach connected-wallet txs
 * (wagmi #5248), so the Builder Code is attached per call in hooks/usePortBundle.ts.
 */
export const config = createConfig({
  chains: [base],
  connectors: [baseAccount({ appName: "Stock Port" }), injected()],
  transports: { [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
