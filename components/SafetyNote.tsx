import { KNOWN_CONTRACTS, basescanAddress } from "@/lib/txGuard";

const REPO = "https://github.com/QijomoFav35/Stock-Port";

/** Short, plain answer to "can this app drain my wallet?" Shown on the Port and Dust cards. */
export default function SafetyNote() {
  return (
    <details className="rounded-xl bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Why this is safe</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-600 dark:text-neutral-400">
        <li>Stock Port never holds your money. Stocks land straight in your own wallet.</li>
        <li>
          You only ever approve the exact amount you are spending, never unlimited. A $20 port can move $20 of USDC and
          nothing more.
        </li>
        <li>
          Swaps go through the official{" "}
          <a className="underline" href={basescanAddress(KNOWN_CONTRACTS.aerodromeRouter.address)} target="_blank" rel="noreferrer">
            Aerodrome router
          </a>{" "}
          (0x is the backup). The app refuses to send anything to any other contract.
        </li>
        <li>You see every step in plain English before your wallet opens, and nothing happens until you confirm.</li>
        <li>
          You can check or remove any approval anytime at{" "}
          <a className="underline" href="https://revoke.cash" target="_blank" rel="noreferrer">
            revoke.cash
          </a>
          .
        </li>
        <li>
          The code is{" "}
          <a className="underline" href={REPO} target="_blank" rel="noreferrer">
            open source
          </a>
          .
        </li>
      </ul>
    </details>
  );
}
