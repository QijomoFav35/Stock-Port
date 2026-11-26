import { createHash, timingSafeEqual } from "node:crypto";

/**
 * True when the request carries `Authorization: Bearer $KEEPER_CRON_SECRET`.
 * Constant-time compare (hash first so lengths always match). Secret must be 32+ chars, e.g. `openssl rand -hex 32`.
 */
export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.KEEPER_CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const a = createHash("sha256").update(header ?? "").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
