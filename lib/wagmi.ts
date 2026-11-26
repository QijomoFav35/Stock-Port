import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";
import { rpcUrl } from "@/lib/rpc";

/**
 * Base Account (passkey smart wallet, no extension needed) + any injected wallet (MetaMask, Rabby,
 * Coinbase Wallet extension). Note: a `dataSuffix` set here would NOT reach connected-wallet txs
 * (wagmi #5248), so the Builder Code is attached per call in hooks/usePortBundle.ts.
 *
 * Installed wallets are also found through EIP-6963; ConnectButton shows only the popular ones (WALLET_ORDER).
 */
export const config = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: "Stock Port", preference: { telemetry: false } }),
    // MetaMask by name, so it shows even when another extension takes over window.ethereum.
    injected({ target: "metaMask" }),
    injected(),
  ],
  transports: { [base.id]: http(rpcUrl()) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
