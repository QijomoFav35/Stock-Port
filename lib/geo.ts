/**
 * Geo rules for trading. Coinbase tokenized stocks are "only available to persons in
 * eligible jurisdictions outside of the U.S." (docs.base.org/sdks/tokenized-stocks/overview).
 *
 * Choice (flag for review): we also block US territories and OFAC comprehensively
 * sanctioned countries. Region-level sanctions (Crimea, DNR, LNR) cannot be detected
 * from a country code alone.
 */
export const BLOCKED_COUNTRIES = new Set([
  // United States + territories
  "US", "PR", "GU", "VI", "AS", "MP", "UM",
  // OFAC comprehensive sanctions
  "CU", "IR", "KP", "SY",
]);

export const GEO_HEADER = "x-vercel-ip-country";

/**
 * Returns true when trading must be blocked for this country.
 * Fails closed in production when the country header is missing.
 */
export function isTradingBlocked(country: string | null | undefined): boolean {
  const override = process.env.GEO_OVERRIDE_COUNTRY; // local testing only
  const c = (override || country || "").toUpperCase();
  if (!c) return process.env.VERCEL_ENV === "production";
  return BLOCKED_COUNTRIES.has(c);
}
