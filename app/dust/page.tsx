import { headers } from "next/headers";
import { GEO_HEADER, isTradingBlocked } from "@/lib/geo";
import DustCard from "@/components/DustCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dust to Stocks · Stock Port",
  description: "Turn the small leftover tokens in your wallet into tokenized stocks on Base.",
};

export default async function DustPage() {
  const geoBlocked = isTradingBlocked((await headers()).get(GEO_HEADER));
  return (
    <main className="mx-auto max-w-xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Dust to Stocks</h1>
        <p className="text-sm text-neutral-500">
          Those leftover tokens worth a few cents or dollars? Sweep them into NVIDIA, Google and Meta in a few taps.
        </p>
      </header>
      <DustCard geoBlocked={geoBlocked} />
      <p className="text-xs text-neutral-500">
        Tokenized stocks track the share price but give no shareholder or voting rights. Not available to US persons.
        Not investment advice.
      </p>
    </main>
  );
}
