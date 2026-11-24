"use client";
import type { PortPlan } from "@/hooks/usePortBundle";
import { basescanAddress } from "@/lib/txGuard";

const fmtUsd = (s: string) => `$${Number(s).toFixed(2)}`;
const fmtQty = (s: string) => Number(s).toLocaleString(undefined, { maximumSignificantDigits: 4 });
const ROUTE: Record<PortPlan["provider"], string> = { aerodrome: "Aerodrome", "0x": "0x", o1: "o1 Exchange" };

/** Plain-English summary of exactly what the wallet will be asked to do. */
export default function ReviewPanel({ plan, onConfirm, onCancel }: { plan: PortPlan; onConfirm: () => void; onCancel: () => void }) {
  let n = 0;
  return (
    <div className="space-y-3 rounded-xl border border-blue-300 dark:border-blue-800 p-3 text-sm">
      <p className="font-semibold">You are about to:</p>
      <ol className="space-y-2">
        {plan.approval && (
          <li>
            <span className="font-medium">{++n}. Allow </span>
            <a className="underline" href={basescanAddress(plan.approval.spender)} target="_blank" rel="noreferrer">
              {plan.approval.spenderName}
            </a>{" "}
            to use exactly <span className="font-medium">{fmtUsd(plan.approval.usdc)} USDC</span>. Not unlimited.
          </li>
        )}
        {plan.buys.map((b) => (
          <li key={b.token}>
            <span className="font-medium">
              {++n}. Buy {b.symbol}
            </span>{" "}
            with {fmtUsd(b.usdc)} USDC
            {b.minOut && <> (you get at least {fmtQty(b.minOut)} {b.symbol}, or the buy is cancelled)</>}. Sent to your wallet.
          </li>
        ))}
      </ol>
      <p className="text-neutral-500">
        Total {fmtUsd(plan.totalUsdc)} USDC via {ROUTE[plan.provider]}. Contracts used:{" "}
        {plan.contracts.map((c, i) => (
          <span key={c.address}>
            {i > 0 && ", "}
            <a className="underline" href={basescanAddress(c.address)} target="_blank" rel="noreferrer">
              {c.name}
            </a>
          </span>
        ))}
        . Your wallet will show {plan.steps === 1 ? "1 step" : `${plan.steps} steps, or one combined prompt if it supports it`}.
      </p>
      <div className="flex gap-2">
        <button onClick={onConfirm} className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white">
          Confirm in wallet
        </button>
        <button onClick={onCancel} className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-4 py-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
