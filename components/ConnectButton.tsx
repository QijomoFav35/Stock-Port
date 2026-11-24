"use client";
/**
 * Wallet connect button on plain wagmi (OnchainKit is deprecated: docs.base.org/onchainkit).
 * Lists every configured connector (Base Account first, then injected wallets).
 */
import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        title="Disconnect"
        className={`rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm font-medium ${className}`}
      >
        {short(address)}
      </button>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="w-full rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-full min-w-48 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => {
                setOpen(false);
                connect({ connector: c });
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {c.name === "Injected" ? "Browser wallet" : c.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error.message.split("\n")[0]}</p>}
    </div>
  );
}
