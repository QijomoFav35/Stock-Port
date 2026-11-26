"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";

/** Anonymous feedback form. Sends only the text and the page it was sent from. */
export default function FeedbackBox() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string>();

  async function send() {
    setState("sending");
    setErr(undefined);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, page: path }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(res.status === 429 ? "Too many messages. Try again in a minute." : body.message ?? "Couldn't send right now.");
      setState("sent");
      setMsg("");
    } catch (e) {
      setState("error");
      setErr((e as Error).message);
    }
  }

  if (!open) {
    return (
      <button type="button" className="linkish" onClick={() => setOpen(true)}>
        Feedback
      </button>
    );
  }
  return (
    <div className="feedback">
      {state === "sent" ? (
        <p style={{ margin: 0 }}>Thanks, got it.</p>
      ) : (
        <>
          <label htmlFor="fb" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            What should we fix or add? Anonymous, no email needed.
          </label>
          <textarea id="fb" className="input" rows={3} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} disabled={state === "sending"} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-blue btn-sm" disabled={msg.trim().length < 3 || state === "sending"} onClick={send}>
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {err && <p className="err">{err}</p>}
        </>
      )}
    </div>
  );
}
