"use client";
import { useState } from "react";
import type { Hash } from "viem";
import Icon from "@/components/Icon";
import { shareOnXUrl, shareUrl, type ShareBasket } from "@/lib/shareLinks";

export default function ShareButtons({
  hashes,
  spent,
  dust = false,
  basket,
  from,
}: {
  hashes: Hash[];
  spent: number;
  dust?: boolean;
  basket?: ShareBasket;
  /** Set for a rotation: the basket the user rotated out of. */
  from?: ShareBasket;
}) {
  const [copied, setCopied] = useState(false);
  if (!hashes.length) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = shareUrl(origin, hashes, dust, basket, from);
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
      <a href={shareOnXUrl(origin, hashes, spent, dust, basket, from)} target="_blank" rel="noreferrer" className="btn btn-ink" style={{ flex: 1, height: 48, fontSize: 15, padding: "0 12px", minWidth: 0 }}>
        <Icon name="ph-x-logo" size={18} />
        Share on X
      </a>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(link).then(
            () => setCopied(true),
            () => window.open(link, "_blank", "noreferrer"),
          );
        }}
        className="btn btn-ghost"
        style={{ flex: 1, height: 48, fontSize: 15, padding: "0 12px", minWidth: 0 }}
      >
        <Icon name={copied ? "ph-check" : "ph-copy"} size={18} />
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
