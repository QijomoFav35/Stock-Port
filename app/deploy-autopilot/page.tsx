"use client";
/** Dev only: deploy AutoPilot to Base from the connected wallet. Run `npm run autopilot:build` first. */
import { useState } from "react";
import { useAccount, useChainId, useConfig, useWalletClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { base } from "viem/chains";
import type { Hex } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { publicClient } from "@/lib/publicClient";

export default function DeployAutoPilot() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletData } = useWalletClient();
  const config = useConfig();
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  if (process.env.NODE_ENV !== "development") return <main style={{ padding: 40 }}>Not found.</main>;

  async function deploy() {
    setBusy(true);
    setOut("Getting your wallet ready…");
    // The hook's client can be missing while the wallet is still reconnecting; ask wagmi for it directly.
    const wallet = walletData ?? (await getWalletClient(config, { chainId: base.id }).catch(() => undefined));
    if (!wallet || !address) {
      setOut("Your wallet isn't ready. Refresh the page (Ctrl+Shift+R), connect again from the top right, then press Deploy.");
      setBusy(false);
      return;
    }
    setOut("Loading bytecode…");
    try {
      const r = await fetch("/api/deploy-autopilot").then((x) => x.json());
      if (!r.bytecode) throw new Error(r.error ?? "No bytecode");
      setOut(`Allowed stocks: ${(r.stocks as string[]).join(", ")}\nLeft out: ${(r.skipped as string[]).join(", ") || "none"}\n\nConfirm the deploy in your wallet…`);
      const hash = await wallet.sendTransaction({ account: address, chain: base, data: r.bytecode as Hex });
      setOut(`Sent ${hash}. Waiting for the receipt…`);
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success" || !rec.contractAddress) throw new Error(`Deploy failed in tx ${hash}`);
      setOut(
        `Deployed.\n\nAdd these to .env.local and Render:\nNEXT_PUBLIC_AUTOPILOT_ADDRESS=${rec.contractAddress}\nNEXT_PUBLIC_AUTOPILOT_FROM_BLOCK=${rec.blockNumber}\n\nhttps://basescan.org/tx/${hash}`,
      );
    } catch (e) {
      setOut((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: "40px 16px", maxWidth: 640, margin: "0 auto" }}>
      <h1 className="disp" style={{ fontSize: 28 }}>Deploy AutoPilot</h1>
      <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
        Local dev only. Deploys contracts/AutoPilot.sol from build/ to Base mainnet with your connected wallet. The contract has no owner, so
        the deployer gets no special rights.
      </p>
      <div style={{ marginTop: 20 }}>
        {!address ? (
          <ConnectButton full />
        ) : chainId !== base.id ? (
          <p className="err">Switch your wallet to Base.</p>
        ) : (
          <button className="btn btn-blue" style={{ width: "100%", height: 54 }} disabled={busy} onClick={deploy}>
            {busy ? "Working…" : "Deploy to Base"}
          </button>
        )}
      </div>
      {out && (
        <pre className="soft num" style={{ marginTop: 20, padding: 16, borderRadius: 14, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {out}
        </pre>
      )}
    </main>
  );
}
