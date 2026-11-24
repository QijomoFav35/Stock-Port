"use client";
import Link from "next/link";
import ConnectButton from "./ConnectButton";

export default function Navbar() {
  return (
    <nav className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 pt-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-lg font-bold">
          Stock Port
        </Link>
        <Link href="/dust" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
          Dust to Stocks
        </Link>
      </div>
      <ConnectButton />
    </nav>
  );
}
