"use client";
import type { Hash } from "viem";
import { shareOnXUrl, shareUrl } from "@/lib/shareLinks";

export default function ShareButtons({ hashes, spent, dust = false }: { hashes: Hash[]; spent: number; dust?: boolean }) {
  if (!hashes.length) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex gap-2 pt-2">
      <a
        href={shareOnXUrl(origin, hashes, spent, dust)}
        target="_blank"
        rel="noreferrer"
        className="flex-1 rounded-xl bg-black py-2 text-center font-semibold text-white dark:bg-white dark:text-black"
      >
        Share on X
      </a>
      <a
        href={shareUrl(origin, hashes, dust)}
        target="_blank"
        rel="noreferrer"
        className="flex-1 rounded-xl border border-neutral-300 py-2 text-center font-semibold dark:border-neutral-700"
      >
        View card
      </a>
    </div>
  );
}
