/**
 * Turn an error into a message that is safe to send to the browser.
 * viem errors embed the RPC URL (which can contain an API key) and the raw request body, so we keep
 * only the short first line and strip URLs and key=value secrets. The full error goes to server logs.
 */
export function publicMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const err = e as { shortMessage?: unknown; message?: unknown } | undefined;
  const raw = typeof err?.shortMessage === "string" ? err.shortMessage : typeof err?.message === "string" ? err.message : "";
  const first = raw.split("\n")[0] ?? "";
  const clean = first
    .replace(/https?:\/\/[^\s"'<>)]+/gi, "[url]")
    .replace(/\b(api[_-]?key|key|token|secret|apikey)=([^\s&"']+)/gi, "$1=[redacted]")
    .replace(/\bbk_[A-Za-z0-9]+/g, "[redacted]")
    .trim()
    .slice(0, 200);
  return clean || fallback;
}

/** Log the full error on the server and return a safe message for the response. */
export function logAndMask(tag: string, e: unknown, fallback?: string): string {
  console.error(`[${tag}]`, e);
  return publicMessage(e, fallback);
}
