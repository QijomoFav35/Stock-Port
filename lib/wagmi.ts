import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected, walletConnect } from "wagmi/connectors";
import { rpcUrl } from "@/lib/rpc";

/**
 * Base Account (passkey smart wallet, no extension needed) + any injected wallet (MetaMask, Rabby,
 * Coinbase Wallet extension). Note: a `dataSuffix` set here would NOT reach connected-wallet txs
 * (wagmi #5248), so the Builder Code is attached per call in hooks/usePortBundle.ts.
 *
 * WalletConnect (QR code for phone wallets) turns on when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * is set. Get a free project ID at dashboard.reown.com.
 */
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export const config = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: "Stock Port", preference: { telemetry: false } }),
    injected(),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "Stock Port",
              description: "Port USDC into a basket of tokenized stocks on Base",
              url: appUrl,
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports: { [base.id]: http(rpcUrl()) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
