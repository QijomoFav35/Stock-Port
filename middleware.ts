import { NextResponse, type NextRequest } from "next/server";
import { GEO_HEADER, clientIp, isTradingBlocked, resolveCountry } from "@/lib/geo";
import { hit, limitFor } from "@/lib/rateLimit";

/**
 * US / sanctioned-country trade block.
 * - Finds the visitor's country (see lib/geo.ts) and passes it on in GEO_HEADER, replacing any
 *   value the browser sent, so pages and API routes can trust it.
 * - /api/swap*: 451 Unavailable For Legal Reasons.
 * - Every other route stays reachable (/, /stats, diary) but gets an
 *   `x-geo-blocked` header and a readable cookie so the UI can disable trading.
 */
export async function middleware(req: NextRequest) {
  // Rate limit every API route per IP before doing any other work (lib/rateLimit.ts has the numbers).
  const limit = limitFor(req.nextUrl.pathname);
  if (limit) {
    const wait = hit(clientIp(req.headers) ?? "unknown", limit.prefix, limit.perMinute);
    if (wait > 0) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "retry-after": String(wait) } },
      );
    }
  }

  const country = (await resolveCountry(req.headers)) ?? "";
  const blocked = isTradingBlocked(country);
  const { pathname } = req.nextUrl;

  if (blocked && pathname.startsWith("/api/swap")) {
    return NextResponse.json(
      {
        error: "geo_blocked",
        message:
          "Tokenized stocks are not available to persons in the United States or in restricted jurisdictions.",
      },
      { status: 451, headers: { "x-geo-blocked": "1" } },
    );
  }

  const headers = new Headers(req.headers);
  headers.set(GEO_HEADER, country);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-geo-blocked", blocked ? "1" : "0");
  res.cookies.set("sp_geo_blocked", blocked ? "1" : "0", { path: "/", sameSite: "lax" });
  return res;
}

export const config = {
  // Run on everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
