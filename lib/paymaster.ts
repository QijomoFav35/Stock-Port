/**
 * Optional gas sponsorship (ERC-7677 paymaster) for smart wallets such as Base Account.
 *
 * Off unless NEXT_PUBLIC_GASLESS=1. The wallet talks to our /api/paymaster proxy, which forwards to
 * CDP_PAYMASTER_URL server-side, so the CDP key never reaches the browser. Wallets that don't support
 * paymasters (most EOAs) just pay gas as usual: the capability is sent as optional.
 */
export const GASLESS = process.env.NEXT_PUBLIC_GASLESS === "1";

export function paymasterCapability(walletSupportsIt: boolean) {
  if (!GASLESS || !walletSupportsIt || typeof window === "undefined") return {};
  return { paymasterService: { url: `${window.location.origin}/api/paymaster`, optional: true } };
}

/** dataSuffix (Builder Code) plus paymaster, or undefined when neither applies. */
export function sendCallsCapabilities(caps: { dataSuffix: boolean; paymaster: boolean }, suffix: `0x${string}`) {
  const out = {
    ...(caps.dataSuffix ? { dataSuffix: { value: suffix, optional: false } } : {}),
    ...paymasterCapability(caps.paymaster),
  };
  return Object.keys(out).length ? out : undefined;
}
