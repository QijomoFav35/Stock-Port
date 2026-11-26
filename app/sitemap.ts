import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const PAGES = ["", "/borrow", "/baskets", "/sweep", "/race", "/stats", "/next", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map((p) => ({ url: `${SITE}${p}`, lastModified: now, changeFrequency: p === "" ? "daily" : "weekly", priority: p === "" ? 1 : 0.7 }));
}
