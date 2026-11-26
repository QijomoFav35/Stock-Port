/**
 * US market clock, same rule as LoanGuard.isWeekendWindow: closed from Friday 20:00 UTC to Monday 01:00 UTC,
 * and on NYSE full-day holidays (00:00 UTC to 01:00 UTC the next day). Holiday list covers Nov 2026 to Dec 2027.
 */
const HOLIDAYS = new Set([20783, 20812, 20819, 20836, 20864, 20903, 20969, 20987, 21004, 21067, 21147, 21176]);

export function marketClosed(ms: number): boolean {
  const ts = Math.floor(ms / 1000);
  const dayNum = Math.floor(ts / 86400);
  const day = (dayNum + 4) % 7; // 0 = Sunday
  const hour = Math.floor((ts % 86400) / 3600);
  if ((day === 5 && hour >= 20) || day === 6 || day === 0 || (day === 1 && hour < 1)) return true;
  return HOLIDAYS.has(dayNum) || (hour < 1 && HOLIDAYS.has(dayNum - 1));
}

/** Ms until the market flips (opens if closed, closes if open), checked hour by hour. */
export function untilFlip(ms: number): number {
  const closed = marketClosed(ms);
  const start = Math.ceil(ms / 3600_000) * 3600_000;
  for (let t = start; t < ms + 8 * 86400_000; t += 3600_000) if (marketClosed(t) !== closed) return t - ms;
  return 0;
}
