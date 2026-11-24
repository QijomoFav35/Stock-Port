/**
 * Geo rules for trading. Coinbase tokenized stocks are "only available to persons in
 * eligible jurisdictions outside of the U.S." (docs.base.org/sdks/tokenized-stocks/overview).
 *
 * Choice (flag for review): we also block US territories and OFAC comprehensively
 * sanctioned countries. Region-level sanctions (Crimea, DNR, LNR) cannot be detected
 * from a country code alone.
 *
 * Works on any host. middleware.ts finds the visitor's country once per request and writes it
 * to GEO_HEADER (overwriting anything the browser sent), so pages and API routes read only that.
 * GEO_SOURCE picks how the country is found:
 *   vercel     – Vercel's x-vercel-ip-country header (default on Vercel)
 *   cloudflare – Cloudflare's cf-ipcountry header (a Cloudflare-proxied custom domain)
 *   ipinfo     – look up the visitor IP with ipinfo.io Lite (needs IPINFO_TOKEN; default elsewhere, e.g. Render)
 */
export const BLOCKED_COUNTRIES = new Set([
  // United States + territories
  "US", "PR", "GU", "VI", "AS", "MP", "UM",
  // OFAC comprehensive sanctions
  "CU", "IR", "KP", "SY",
]);

/** Internal header set by middleware.ts only. Never trust a browser-supplied value. */
export const GEO_HEADER = "x-sp-country";

type GeoSource = "vercel" | "cloudflare" | "ipinfo";

export function geoSource(): GeoSource {
  const s = process.env.GEO_SOURCE;
  if (s === "vercel" || s === "cloudflare" || s === "ipinfo") return s;
  return process.env.VERCEL ? "vercel" : process.env.IPINFO_TOKEN ? "ipinfo" : "cloudflare";
}

/** Visitor IP as seen by the host's proxy (Cloudflare-style headers first, then X-Forwarded-For). */
export function clientIp(h: Headers): string | undefined {
  return (
    h.get("cf-connecting-ip") ??
    h.get("true-client-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}

const cache = new Map<string, { country: string; at: number }>();
const CACHE_MS = 6 * 3600 * 1000;

async function lookupIpinfo(ip: string): Promise<string | undefined> {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.country;
  const token = process.env.IPINFO_TOKEN;
  if (!token) return undefined;
  try {
    const res = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${token}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { country_code?: string };
    const country = body.country_code?.toUpperCase();
    if (country) {
      if (cache.size > 10_000) cache.clear();
      cache.set(ip, { country, at: Date.now() });
    }
    return country;
  } catch {
    return undefined;
  }
}

/** Country code for this request, or undefined if it can't be determined. */
export async function resolveCountry(h: Headers): Promise<string | undefined> {
  const source = geoSource();
  if (source === "vercel") return h.get("x-vercel-ip-country")?.toUpperCase() || undefined;
  if (source === "cloudflare") return h.get("cf-ipcountry")?.toUpperCase() || undefined;
  const ip = clientIp(h);
  return ip ? lookupIpinfo(ip) : undefined;
}

/**
 * Returns true when trading must be blocked for this country.
 * Fails closed in production when the country is unknown ("XX"/"T1" from Cloudflare count as unknown).
 */
export function isTradingBlocked(country: string | null | undefined): boolean {
  const override = process.env.GEO_OVERRIDE_COUNTRY; // local testing only
  let c = (override || country || "").toUpperCase();
  if (c === "XX" || c === "T1") c = ""; // Cloudflare: unknown / Tor
  if (!c) return process.env.NODE_ENV === "production";
  return BLOCKED_COUNTRIES.has(c);
}
