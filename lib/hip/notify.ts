// Admin email for Hip events (Resend, same env as the TES webhook).
// Failures never propagate — a missed email must not stall the poller.

export async function sendAdminEmail(subject: string, html: string): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    const to = process.env.ADMIN_EMAIL;
    if (!apiKey || !from || !to) return false;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return res.ok;
  } catch (err) {
    console.error("[hip notify] failed", err);
    return false;
  }
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
