import type { Address, WalletClient } from "viem";
import { base } from "viem/chains";

/** EIP-5792 capabilities we care about on Base. Wallets without EIP-5792 report none. */
export async function getBaseCapabilities(wc: WalletClient, account: Address) {
  try {
    const caps = (await wc.getCapabilities({ account, chainId: base.id })) as Record<
      string,
      { status?: string; supported?: boolean } | undefined
    >;
    const atomic = ["supported", "ready"].includes(caps?.atomic?.status ?? "");
    const dataSuffix = caps?.dataSuffix?.supported === true;
    const paymaster = caps?.paymasterService?.supported === true;
    return { atomic, dataSuffix, paymaster };
  } catch {
    return { atomic: false, dataSuffix: false, paymaster: false }; // wallet has no EIP-5792 support
  }
}

export function shortError(e: unknown) {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  return m.length > 240 ? m.slice(0, 240) + "…" : m;
}

/** True when the user pressed "reject" in their wallet (EIP-1193 code 4001). */
export function isUserRejection(e: unknown) {
  const err = e as { code?: number; cause?: { code?: number }; name?: string };
  return err?.code === 4001 || err?.cause?.code === 4001 || err?.name === "UserRejectedRequestError";
}
