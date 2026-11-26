/**
 * Small in-memory rate limiter (fixed one-minute windows per IP and route group).
 * Fine for one Render instance. With several instances, each keeps its own counts, so the real
 * limit is that many times higher: move this to Redis/Upstash before scaling out.
 */
type Bucket = { start: number; count: number };
const g = globalThis as unknown as { __spRate?: Map<string, Bucket> };
const buckets = (g.__spRate ??= new Map());

/** Requests per minute per IP for each group of API routes. */
export const LIMITS: { prefix: string; perMinute: number }[] = [
  { prefix: "/api/rpc", perMinute: 600 },
  { prefix: "/api/swap", perMinute: 40 },
  { prefix: "/api/paymaster", perMinute: 60 },
  { prefix: "/api/guard/keeper", perMinute: 10 },
  { prefix: "/api/autopilot/run", perMinute: 10 },
  { prefix: "/api/feedback", perMinute: 5 },
  { prefix: "/api/", perMinute: 120 },
];

export function limitFor(pathname: string) {
  return LIMITS.find((l) => pathname.startsWith(l.prefix));
}

/** Returns seconds to wait when over the limit, else 0. */
export function hit(ip: string, group: string, perMinute: number, now = Date.now()): number {
  const key = `${group}|${ip}`;
  const b = buckets.get(key);
  if (!b || now - b.start >= 60_000) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 50_000) prune(now);
    return 0;
  }
  b.count++;
  return b.count > perMinute ? Math.ceil((b.start + 60_000 - now) / 1000) : 0;
}

function prune(now: number) {
  for (const [k, b] of buckets) if (now - b.start >= 60_000) buckets.delete(k);
}
