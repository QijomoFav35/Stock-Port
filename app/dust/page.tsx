import { permanentRedirect } from "next/navigation";

/** Dust Sweep moved to /sweep. Keeps old links and shared posts working. */
export default function DustPage() {
  permanentRedirect("/sweep");
}
