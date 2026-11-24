/**
 * GET /share/image?tx=0x..,0x..&dust=1 → 1200×630 PNG share card, built from onchain data.
 */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getShareData, parseTxParam } from "@/lib/share";

export const revalidate = 3600;

const fmtShares = (n: number) => (n >= 1 ? n.toFixed(3) : n.toPrecision(3));

export async function GET(req: NextRequest) {
  const hashes = parseTxParam(req.nextUrl.searchParams.get("tx"));
  const dust = req.nextUrl.searchParams.get("dust") === "1";
  const data = await getShareData(hashes).catch(() => null);

  const headline = !data
    ? "Tokenized stocks on Base, in one tap"
    : dust
      ? `Turned $${data.spentUsdc.toFixed(2)} of dust into stocks`
      : `Ported $${data.spentUsdc.toFixed(2)} into stocks`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0b1b4d 0%, #0052ff 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 36, fontWeight: 700 }}>Stock Port</div>
          <div style={{ fontSize: 26, opacity: 0.8 }}>on Base</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1 }}>{headline}</div>
          {data && (
            <div style={{ display: "flex", gap: 20 }}>
              {data.legs.map((l) => (
                <div
                  key={l.symbol}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 22px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.14)",
                    fontSize: 30,
                  }}
                >
                  {l.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.icon} width={40} height={40} style={{ borderRadius: 999 }} alt="" />
                  )}
                  <span style={{ fontWeight: 700 }}>{l.symbol}</span>
                  <span style={{ opacity: 0.8 }}>{fmtShares(l.shares)} sh</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, opacity: 0.75 }}>
          <span>Read from Base mainnet</span>
          <span>Not available to US persons · No shareholder rights</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
