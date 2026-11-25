import type { Metadata } from "next";
import Link from "next/link";
import { getShareData, parseTxParam } from "@/lib/share";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function imageUrl(sp: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams({ tx: parseTxParam(sp.tx).join(",") });
  if (sp.dust === "1") q.set("dust", "1");
  if (typeof sp.b === "string") q.set("b", sp.b);
  if (typeof sp.from === "string") q.set("from", sp.from);
  return `/share/image?${q}`;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const img = imageUrl(sp);
  const title =
    typeof sp.from === "string"
      ? "Rotated my tokenized stocks basket"
      : sp.dust === "1"
        ? "Swept my dust into tokenized stocks"
        : "Copied a basket of tokenized stocks";
  return {
    metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
    title: `${title} · Stock Port`,
    openGraph: { title, images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [img] },
  };
}

export default async function SharePage({ searchParams }: Props) {
  const sp = await searchParams;
  const hashes = parseTxParam(sp.tx);
  const data = await getShareData(hashes).catch(() => null);
  return (
    <main className="wrap" style={{ maxWidth: 760, paddingTop: 56, paddingBottom: 48 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(sp)} alt="Stock Port share card" style={{ width: "100%", borderRadius: 24, border: "1px solid var(--line)", display: "block" }} />
      {data ? (
        <p style={{ fontSize: 14, color: "var(--g60)", marginTop: 16 }}>
          <span className="num">
            {data.owner.slice(0, 6)}…{data.owner.slice(-4)}
          </span>{" "}
          spent <span className="num">${data.spentUsdc.toFixed(2)}</span> USDC on {data.legs.map((l) => l.symbol).join(", ")}. Read from
          Base:{" "}
          {hashes.map((h, i) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer">
              tx {i + 1}
              {i < hashes.length - 1 ? ", " : ""}
            </a>
          ))}
        </p>
      ) : (
        <p style={{ fontSize: 14, color: "var(--g60)", marginTop: 16 }}>We couldn&apos;t read this tx from Base.</p>
      )}
      <Link href="/#buy" className="btn btn-blue" style={{ width: "100%", marginTop: 20 }}>
        Pick a basket from $5
      </Link>
    </main>
  );
}
