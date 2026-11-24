import { NextResponse, type NextRequest } from "next/server";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";

/**
 * US / sanctioned-country trade block.
 * - /api/swap*: 451 Unavailable For Legal Reasons.
 * - Every other route stays reachable (/, /stats, diary) but gets an
 *   `x-geo-blocked` header and a readable cookie so the UI can disable trading.
 */
export function middleware(req: NextRequest) {
  const country = req.headers.get(GEO_HEADER);
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

  const res = NextResponse.next();
  res.headers.set("x-geo-blocked", blocked ? "1" : "0");
  res.cookies.set("sp_geo_blocked", blocked ? "1" : "0", { path: "/", sameSite: "lax" });
  return res;
}

export const config = {
  // Run on everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
