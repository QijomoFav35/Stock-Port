/** Client-safe share link builders (no server imports). */
import type { Hash } from "viem";

export function shareUrl(origin: string, hashes: Hash[], dust = false) {
  const q = new URLSearchParams({ tx: hashes.join(",") });
  if (dust) q.set("dust", "1");
  return `${origin}/share?${q}`;
}

export function shareOnXUrl(origin: string, hashes: Hash[], spent: number, dust = false) {
  const text = dust
    ? `I just turned $${spent.toFixed(2)} of wallet dust into NVIDIA, Google and Meta on @base with Stock Port.`
    : `I just ported $${spent.toFixed(2)} into NVIDIA, Google and Meta on @base with Stock Port.`;
  const q = new URLSearchParams({ text, url: shareUrl(origin, hashes, dust) });
  return `https://x.com/intent/post?${q}`;
}
