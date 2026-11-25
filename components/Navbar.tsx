"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "./ConnectButton";

export function LogoMark({ size = 30, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill={inverted ? "#fff" : "#0000FF"} />
      <path
        d="M8 18.5l4.5-4.5 3 3L20 12.5M16.5 12.5H20V16"
        fill="none"
        stroke={inverted ? "#0000FF" : "#fff"}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LINKS = [
  { href: "/borrow", label: "Borrow" },
  { href: "/baskets", label: "Baskets" },
  { href: "/sweep", label: "Sweep" },
  { href: "/race", label: "Race" },
  { href: "/next", label: "What's next" },
];

export default function Navbar() {
  const path = usePathname();
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(255,255,255,.82)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="wrap" style={{ height: 68, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink)" }}>
          <LogoMark />
          <span className="wordmark nowrap">Stock Port</span>
        </Link>
        <div className="navlinks" style={{ display: "flex", alignItems: "center", gap: 30, fontSize: 15, fontWeight: 600 }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={{ color: path === l.href ? "var(--ink)" : "var(--g60)" }}>
              {l.label}
            </Link>
          ))}
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
