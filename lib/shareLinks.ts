/** Client-safe share link builders (no server imports). */
import type { Hash } from "viem";

export function shareUrl(origin: string, hashes: Hash[], dust = false) {
  const q = new URLSearchParams({ tx: hashes.join(",") });
  if (dust) q.set("dust", "1");
  return `${origin}/share?${q}`;
}

export function shareOnXUrl(origin: string, hashes: Hash[], spent: number, dust = false) {
  const text = dust
    ? `Swept $${spent.toFixed(2)} of dust into tokenized stocks (NVDAc, GOOGLc, METAc) on @base with Stock Port.`
    : `Copied the AI's bag: $${spent.toFixed(2)} into tokenized stocks (NVDAc, GOOGLc, METAc) on @base with Stock Port.`;
  const q = new URLSearchParams({ text, url: shareUrl(origin, hashes, dust) });
  return `https://x.com/intent/post?${q}`;
}
