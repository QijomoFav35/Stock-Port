"use client";
/** Dev only: deploy LoanGuard to Base from the connected wallet. Run `npm run guard:build` first. */
import { useState } from "react";
import { useAccount, useChainId, useConfig, useWalletClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { base } from "viem/chains";
import { concat, getContractAddress, keccak256, toHex, type Hex } from "viem";
import ConnectButton from "@/components/ConnectButton";
import { publicClient } from "@/lib/publicClient";

/**
 * Deterministic deployment proxy (same address on every chain). Deploying through it works from any wallet,
 * including smart wallets like Base Account, which can't send a plain contract-creation tx.
 */
const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

export default function DeployGuard() {
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
      const r = await fetch("/api/deploy-guard").then((x) => x.json());
      if (!r.bytecode) throw new Error(r.error ?? "No bytecode");
      setOut("Confirm the deploy in your wallet…");
      const bytecode = r.bytecode as Hex;
      const salt = keccak256(toHex(`stock-port-${address}-${Date.now()}`));
      const contractAddress = getContractAddress({ opcode: "CREATE2", from: CREATE2_FACTORY, salt, bytecode });
      const hash = await wallet.sendTransaction({ account: address, chain: base, to: CREATE2_FACTORY, data: concat([salt, bytecode]) });
      setOut(`Sent ${hash}. Waiting for the receipt…`);
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      const code = rec.status === "success" ? await publicClient.getCode({ address: contractAddress }) : undefined;
      if (!code || code === "0x") throw new Error(`Deploy failed in tx ${hash}`);
      setOut(
        `Deployed.\n\nAdd these to .env.local and Render:\nNEXT_PUBLIC_LOAN_GUARD_ADDRESS=${contractAddress}\nNEXT_PUBLIC_LOAN_GUARD_FROM_BLOCK=${rec.blockNumber}\n\nhttps://basescan.org/tx/${hash}`,
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
