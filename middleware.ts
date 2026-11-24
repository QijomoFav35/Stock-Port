import { NextResponse, type NextRequest } from "next/server";
import { GEO_HEADER, isTradingBlocked, resolveCountry } from "@/lib/geo";

/**
 * US / sanctioned-country trade block.
 * - Finds the visitor's country (see lib/geo.ts) and passes it on in GEO_HEADER, replacing any
 *   value the browser sent, so pages and API routes can trust it.
 * - /api/swap*: 451 Unavailable For Legal Reasons.
 * - Every other route stays reachable (/, /stats, diary) but gets an
 *   `x-geo-blocked` header and a readable cookie so the UI can disable trading.
 */
export async function middleware(req: NextRequest) {
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
