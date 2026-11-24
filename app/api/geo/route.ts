/**
 * GET /api/geo → what the server thinks your country is. Use it once after deploying to confirm
 * the US block works on this host. Shows no IP and no secrets.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GEO_HEADER, geoSource, isTradingBlocked } from "@/lib/geo";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const country = req.headers.get(GEO_HEADER) || null;
  return NextResponse.json({
    source: geoSource(),
    country,
    tradingBlocked: isTradingBlocked(country),
    ipinfoConfigured: Boolean(process.env.IPINFO_TOKEN),
  });
}
