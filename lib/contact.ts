/**
 * Public contact links, from env so nothing personal is hard-coded in the repo.
 * NEXT_PUBLIC_CONTACT_X: X handle without @ (e.g. stockport). NEXT_PUBLIC_CONTACT_EMAIL: a project inbox, not a personal one.
 */
export const REPO_URL = "https://github.com/QijomoFav35/Stock-Port";

export function contactLinks(): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const x = process.env.NEXT_PUBLIC_CONTACT_X?.replace(/^@/, "").trim();
  if (x && /^[A-Za-z0-9_]{1,15}$/.test(x)) out.push({ label: `@${x} on X`, href: `https://x.com/${x}` });
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push({ label: email, href: `mailto:${email}` });
  out.push({ label: "GitHub issues", href: `${REPO_URL}/issues` });
  return out;
}
