/**
 * Email for patients: appointment confirmations and invoices.
 * Uses Resend's web API (no extra package). Set RESEND_API_KEY and EMAIL_FROM (an address on a domain you verified in Resend,
 * for example "Clinic Name <hello@yourdomain.com>"). Without them nothing is sent and nothing breaks.
 */
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export const isEmail = (s?: string | null) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Plain text in, simple HTML out (line breaks kept, links made clickable). */
export function textToHtml(text: string): string {
  const body = esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${body}</div>`;
}

export async function sendEmail(to: string, subject: string, text: string, replyTo?: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured()) return { ok: false, error: "Email is not set up" };
  if (!isEmail(to)) return { ok: false, error: "No valid email address" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to.trim()], subject: subject.slice(0, 150), text: text.replace(/\*/g, ""), html: textToHtml(text), ...(replyTo && isEmail(replyTo) ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { const j: any = await res.json().catch(() => ({})); return { ok: false, error: j?.message ?? `Email error ${res.status}` }; }
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
