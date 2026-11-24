import type { Metadata } from "next";
import Link from "next/link";
import { getShareData, parseTxParam } from "@/lib/share";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function imageUrl(sp: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams({ tx: parseTxParam(sp.tx).join(",") });
  if (sp.dust === "1") q.set("dust", "1");
  return `/share/image?${q}`;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const img = imageUrl(sp);
  const title = sp.dust === "1" ? "I turned my wallet dust into stocks" : "I ported into tokenized stocks on Base";
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
    <main className="mx-auto max-w-xl px-4 py-10 space-y-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(sp)} alt="Stock Port share card" className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-800" />
      {data ? (
        <p className="text-sm text-neutral-500">
          {data.owner.slice(0, 6)}…{data.owner.slice(-4)} spent ${data.spentUsdc.toFixed(2)} USDC on{" "}
          {data.legs.map((l) => l.symbol).join(", ")}. Read from Base:{" "}
          {hashes.map((h, i) => (
            <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noreferrer" className="underline">
              tx {i + 1}
              {i < hashes.length - 1 ? ", " : ""}
            </a>
          ))}
        </p>
      ) : (
        <p className="text-sm text-neutral-500">We couldn&apos;t read this buy from Base.</p>
      )}
      <Link href="/" className="block w-full rounded-xl bg-blue-600 py-3 text-center font-semibold text-white">
        Port into the basket yourself
      </Link>
    </main>
  );
}
