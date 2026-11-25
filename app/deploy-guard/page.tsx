"use client";
/** Dev only: deploy LoanGuard to Base from the connected wallet. Run `npm run guard:build` first. */
import { useState } from "react";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { base } from "viem/chains";
import type { Hex } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { publicClient } from "@/lib/publicClient";

export default function DeployGuard() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: wallet } = useWalletClient();
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  if (process.env.NODE_ENV !== "development") return <main style={{ padding: 40 }}>Not found.</main>;

  async function deploy() {
    if (!wallet || !address) return;
    setBusy(true);
    setOut("Loading bytecode…");
    try {
      const r = await fetch("/api/deploy-guard").then((x) => x.json());
      if (!r.bytecode) throw new Error(r.error ?? "No bytecode");
      setOut("Confirm the deploy in your wallet…");
      const hash = await wallet.sendTransaction({ account: address, chain: base, data: r.bytecode as Hex });
      setOut(`Sent ${hash}. Waiting for the receipt…`);
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success" || !rec.contractAddress) throw new Error(`Deploy failed in tx ${hash}`);
      setOut(
        `Deployed.\n\nAdd these to .env.local and Render:\nNEXT_PUBLIC_LOAN_GUARD_ADDRESS=${rec.contractAddress}\nNEXT_PUBLIC_LOAN_GUARD_FROM_BLOCK=${rec.blockNumber}\n\nhttps://basescan.org/tx/${hash}`,
      );
    } catch (e) {
      setOut((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: "40px 16px", maxWidth: 640, margin: "0 auto" }}>
      <h1 className="disp" style={{ fontSize: 28 }}>Deploy Loan Guard</h1>
      <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
        Local dev only. Deploys contracts/LoanGuard.sol from build/ to Base mainnet with your connected wallet. The contract has no owner, so
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
