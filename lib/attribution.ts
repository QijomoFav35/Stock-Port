import { Attribution } from "ox/erc8021";
import { concat, type Hex } from "viem";

/**
 * ERC-8021 Base Builder Code. Get it from dashboard.base.org → Settings → Builder Code
 * (looks like `bc_xxxxxxxx`). Public value, so NEXT_PUBLIC_ is fine.
 */
export const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE ?? "";

export const DATA_SUFFIX: Hex | undefined = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : undefined;

/** Throws if no Builder Code is configured. Every tx must carry it, so we refuse to send without it. */
export function requireDataSuffix(): Hex {
  if (!DATA_SUFFIX) {
    throw new Error("NEXT_PUBLIC_BASE_BUILDER_CODE is not set. Refusing to send an unattributed transaction.");
  }
  return DATA_SUFFIX;
}

/** Appends the suffix to calldata (EOA fallback path). Idempotent. */
export function withBuilderCode(data: Hex | undefined): Hex {
  const suffix = requireDataSuffix();
  const d = data ?? "0x";
  if (d.toLowerCase().endsWith(suffix.slice(2).toLowerCase())) return d;
  return concat([d, suffix]);
}

/** True when calldata carries our Builder Code (use to verify a mined tx's input). */
export function hasBuilderCode(data: Hex): boolean {
  try {
    return Attribution.fromData(data)?.codes?.includes(BUILDER_CODE) ?? false;
  } catch {
    return false;
  }
}
