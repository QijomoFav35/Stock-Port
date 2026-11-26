/**
 * POST /api/feedback  Body: { message, page? }
 * Forwards anonymous feedback to a private Discord channel webhook (FEEDBACK_WEBHOOK_URL, server only).
 * Nothing is stored here, no email is asked for, and the IP is not forwarded. Rate-limited in middleware.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logAndMask } from "@/lib/safeError";

export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(3).max(1000),
  page: z.string().max(100).regex(/^\/[A-Za-z0-9/_-]*$/).optional(),
});

/** Stop pings and links from turning the channel into a spam target. */
const defang = (s: string) => s.replace(/@(everyone|here)/gi, "@​$1").replace(/<@[!&]?\d+>/g, "[mention]").replace(/https?:\/\//gi, "hxxp://");

export async function POST(req: NextRequest) {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return NextResponse.json({ error: "feedback_off" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request", message: "Write between 3 and 1000 characters." }, { status: 400 });
  const { message, page } = parsed.data;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Stock Port feedback",
        content: `**${page ?? "/"}**\n${defang(message)}`.slice(0, 1900),
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "send_failed", message: logAndMask("feedback", e, "Couldn't send right now. Try again later.") }, { status: 502 });
  }
}
