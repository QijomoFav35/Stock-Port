/** Client-safe share link builders (no server imports). */
import type { Hash } from "viem";

export type ShareBasket = { id: string; name: string };

export function shareUrl(origin: string, hashes: Hash[], dust = false, basket?: ShareBasket, from?: ShareBasket) {
  const q = new URLSearchParams({ tx: hashes.join(",") });
  if (dust) q.set("dust", "1");
  if (basket) q.set("b", basket.id);
  if (from) q.set("from", from.id);
  return `${origin}/share?${q}`;
}

export function shareOnXUrl(origin: string, hashes: Hash[], spent: number, dust = false, basket?: ShareBasket, from?: ShareBasket) {
  const usd = "$" + spent.toFixed(2);
  const bag = basket ? `the ${basket.name} basket` : "tokenized stocks";
  const text = from && basket
    ? `Rotated out of ${from.name} into ${basket.name}: ${usd} of tokenized stocks, one tx on @base with Stock Port.`
    : dust
      ? `Swept ${usd} of dust into ${bag} on @base with Stock Port.`
      : `Copied ${bag}: ${usd} into tokenized stocks on @base with Stock Port.`;
  const q = new URLSearchParams({ text, url: shareUrl(origin, hashes, dust, basket, from) });
  return `https://x.com/intent/post?${q}`;
}
