/**
 * GET /share/image?tx=0x..,0x..&dust=1 → 1200×630 PNG share card, built from onchain data.
 * Base Blue background, Base palette only.
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
    ? "Own what the AI owns."
    : dust
      ? `Swept $${data.spentUsdc.toFixed(2)} of dust into tokenized stocks.`
      : `Copied the AI's bag: $${data.spentUsdc.toFixed(2)} into tokenized stocks.`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          background: "#0000FF",
          color: "white",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -90,
            top: -90,
            width: 440,
            height: 440,
            borderRadius: 110,
            background: "rgba(255,255,255,0.07)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="44" height="44" viewBox="0 0 28 28">
              <rect width="28" height="28" rx="8" fill="#fff" />
              <path d="M8 18.5l4.5-4.5 3 3L20 12.5M16.5 12.5H20V16" fill="none" stroke="#0000FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 8 }}>STOCK PORT</div>
          </div>
          <div
            style={{
              display: "flex",
              background: "#FFD12F",
              color: "#0A0B0D",
              padding: "8px 20px",
              borderRadius: 999,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            {dust ? "DUST SWEPT" : "BAG COPIED"}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, lineHeight: 1.05, maxWidth: 1040, letterSpacing: -2 }}>{headline}</div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {(data?.legs ?? []).map((l) => (
              <div
                key={l.symbol}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 20px 8px 8px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  fontSize: 24,
                }}
              >
                {l.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.icon} width={40} height={40} style={{ borderRadius: 999, background: "white" }} alt="" />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 999, background: "white", display: "flex" }} />
                )}
                <span style={{ fontWeight: 700 }}>{l.symbol}</span>
                <span style={{ opacity: 0.8 }}>{fmtShares(l.shares)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 18, opacity: 0.85 }}>
            <span>built on Base · read onchain</span>
            <span>Not for US persons · no shareholder rights</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
