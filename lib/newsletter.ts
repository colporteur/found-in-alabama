// Helpers for the newsletter subscriber list:
//   • token generation + SHA-256 hashing (mirrors lib/api-keys.ts)
//   • email validation + normalization
//   • Resend HTTP send for confirmation emails (no SDK needed — single
//     fetch call against api.resend.com/emails)

import crypto from "node:crypto";

export const CONFIRM_TOKEN_TTL_HOURS = 72;

export type GeneratedToken = { raw: string; hash: string };

/** 32 random bytes, base64url-encoded (~43 chars), plus its SHA-256 hex hash. */
export function generateToken(): GeneratedToken {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Lowercased + trimmed; safe for the unique constraint and lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive — we rely on the confirm step to prove the
 *  address actually receives mail. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  if (email.length > 254) return false;
  return EMAIL_RE.test(email);
}

const SITE_URL = "https://www.foundinalabama.com";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function senderAddress(): string {
  // Falls back to a sensible default if AUTH_EMAIL_FROM (the value Resend
  // is already configured with for sign-in emails) isn't set in this env.
  return process.env.AUTH_EMAIL_FROM
    ?? "Found in Alabama <hello@foundinalabama.com>";
}

export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Send an email via Resend's HTTP API directly. Single fetch — no SDK.
 * Returns a discriminated union so the caller can branch on success/failure.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<ResendSendResult> {
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Resend API key not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderAddress(),
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Resend HTTP ${res.status}: ${body.slice(0, 400)}`,
      };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Resend call failed",
    };
  }
}

// ─── Confirmation email ─────────────────────────────────────────────────

export function confirmUrl(rawToken: string): string {
  return `${SITE_URL}/api/newsletter/confirm?token=${encodeURIComponent(rawToken)}`;
}

export function unsubscribeUrl(rawToken: string): string {
  return `${SITE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(rawToken)}`;
}

const CONFIRM_SUBJECT = "Confirm your Found in Alabama subscription";

function confirmEmailHtml(confirmHref: string): string {
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8f5ee; padding:32px 16px; color:#1c1a17;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px; background:#fff; border:1px solid #e5e1d5; border-radius:8px; padding:32px;">
    <tr><td>
      <h1 style="font-family:'Permanent Marker', cursive; font-weight:400; font-size:28px; line-height:1.15; margin:0 0 16px;">One more click and you&rsquo;re in.</h1>
      <p style="font-size:16px; line-height:1.55; margin:0 0 24px;">Thanks for signing up for the Found in Alabama newsletter. Hit the button below to confirm your email and we&rsquo;ll see you in your inbox at the start of next month.</p>
      <p style="margin:0 0 24px;">
        <a href="${confirmHref}" style="display:inline-block; background:#f4c430; color:#1c1a17; text-decoration:none; padding:14px 24px; border-radius:6px; font-weight:600; font-size:16px;">Confirm subscription</a>
      </p>
      <p style="font-size:14px; line-height:1.55; color:#65615a; margin:0 0 8px;">Or paste this link into your browser:</p>
      <p style="font-size:13px; word-break:break-all; color:#65615a; margin:0 0 24px;"><a href="${confirmHref}" style="color:#65615a;">${confirmHref}</a></p>
      <p style="font-size:13px; line-height:1.55; color:#a09c92; margin:0; border-top:1px solid #e5e1d5; padding-top:16px;">If you didn&rsquo;t sign up, ignore this and you won&rsquo;t hear from us again. The confirmation link expires in ${CONFIRM_TOKEN_TTL_HOURS} hours.</p>
    </td></tr>
  </table>
</body></html>`;
}

function confirmEmailText(confirmHref: string): string {
  return `Thanks for signing up for the Found in Alabama newsletter.

Confirm your email by visiting this link (expires in ${CONFIRM_TOKEN_TTL_HOURS} hours):

${confirmHref}

If you didn't sign up, ignore this message and you won't hear from us again.

— Found in Alabama
`;
}

export async function sendConfirmEmail(
  to: string,
  rawConfirmToken: string
): Promise<ResendSendResult> {
  const href = confirmUrl(rawConfirmToken);
  return sendEmail({
    to,
    subject: CONFIRM_SUBJECT,
    html: confirmEmailHtml(href),
    text: confirmEmailText(href),
  });
}
