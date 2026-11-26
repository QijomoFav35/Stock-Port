"use client";
/**
 * Wallet connect button on plain wagmi (OnchainKit is deprecated: docs.base.org/onchainkit).
 * Lists every configured connector (Base Account first, then injected wallets).
 */
import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icons";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Wallets we list, in this order. Anything else an extension announces is hidden. */
const WALLET_ORDER: { key: string; match: (id: string, name: string) => boolean }[] = [
  { key: "base", match: (id, n) => id === "baseAccount" || /base account/i.test(n) },
  { key: "metamask", match: (id, n) => id === "metaMask" || id === "io.metamask" || /metamask/i.test(n) },
  { key: "coinbase", match: (id, n) => id === "com.coinbase.wallet" || /coinbase/i.test(n) },
  { key: "rabby", match: (id, n) => id === "io.rabby" || /rabby/i.test(n) },
  { key: "phantom", match: (id, n) => id === "app.phantom" || /phantom/i.test(n) },
  { key: "rainbow", match: (id, n) => id === "me.rainbow" || /rainbow/i.test(n) },
  { key: "trust", match: (id, n) => id === "com.trustwallet.app" || /trust wallet/i.test(n) },
  { key: "okx", match: (id, n) => id === "com.okex.wallet" || /okx/i.test(n) },
  { key: "zerion", match: (id, n) => id === "io.zerion.wallet" || /zerion/i.test(n) },
  { key: "browser", match: (id) => id === "injected" },
];

/** Popular wallets only, one entry each, in WALLET_ORDER. */
function pickConnectors<T extends { id: string; name: string }>(all: readonly T[]): T[] {
  const out: T[] = [];
  for (const w of WALLET_ORDER) {
    const found = all.filter((c) => w.match(c.id, c.name));
    // Prefer the wallet's own EIP-6963 entry (it has the real icon and provider) over the generic one.
    const best = found.find((c) => c.id.includes(".")) ?? found[0];
    if (best) out.push(best);
  }
  // A generic "Browser wallet" is only useful when no named wallet was found.
  const named = out.filter((c) => c.id !== "injected" && c.id !== "baseAccount");
  return named.length ? out.filter((c) => c.id !== "injected") : out;
}

function walletIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (n.includes("base") || n.includes("coinbase")) return "w-coinbase";
  if (n.includes("metamask")) return "w-metamask";
  if (n.includes("rabby")) return "w-rabby";
  if (n.includes("rainbow")) return "w-rainbow";
  if (n.includes("phantom")) return "w-phantom";
  return "ph-wallet";
}

export default function ConnectButton({ className = "", full = false }: { className?: string; full?: boolean }) {
  const { address, isConnected, status } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect, disconnectAsync } = useDisconnect();
  const [open, setOpen] = useState(false);

  // A wallet can get stuck half-connected (status "reconnecting" with an address). Offer a clean reset.
  if (!isConnected && address && (status === "reconnecting" || status === "connecting")) {
    return (
      <button onClick={() => disconnectAsync().catch(() => {}).finally(() => setOpen(true))} className={`btn btn-ghost btn-sm ${className}`}>
        Reconnecting… tap to reset
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} title="Disconnect" className={`btn btn-ghost btn-sm num ${className}`}>
        <span className="live" />
        {short(address)}
      </button>
    );
  }

  return (
    <div className={className} style={{ position: "relative", width: full ? "100%" : undefined }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className={`btn btn-blue ${full ? "" : "btn-sm"}`}
        style={{ width: full ? "100%" : undefined }}
        aria-expanded={open}
      >
        <Icon name="ph-wallet" size={18} />
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, zIndex: 40, marginTop: 8, width: "100%", minWidth: 260, padding: 8 }}
        >
          <div className="eyebrow" style={{ padding: "8px 12px" }}>
            Connect a wallet
          </div>
          {pickConnectors(connectors).map((c, i) => (
            <button
              key={c.uid}
              onClick={() => {
                setOpen(false);
                connect({ connector: c });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "12px",
                border: 0,
                borderRadius: 12,
                background: "transparent",
                font: "600 15px var(--font-montserrat), sans-serif",
                color: "var(--ink)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--raised)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Icon name={walletIcon(c.name)} size={24} />
              <span style={{ flex: 1 }}>{c.name === "Injected" ? "Browser wallet" : c.name}</span>
              {i === 0 && (
                <span className="tag" style={{ background: "var(--lime)", color: "var(--ink)", fontSize: 10, padding: "2px 8px" }}>
                  Recommended
                </span>
              )}
            </button>
          ))}
          <p style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--g60)", padding: "8px 12px 4px", margin: 0 }}>
            <span style={{ color: "var(--green)" }}>
              <Icon name="ph-shield-check" size={16} />
            </span>
            Connecting is read-only. Nothing moves until you sign.
          </p>
        </div>
      )}
      {error && (
        <p className="err" style={{ marginTop: 6, fontSize: 12 }}>
          {/already connected/i.test(error.message) ? "Your wallet is already connected. Refresh the page." : error.message.split("\n")[0]}
        </p>
      )}
    </div>
  );
}
