// Inbound mail storage for the site inbox (Phase MAIL-1). Called by
// POST /api/email/inbound, which the "fia-inbox" Cloudflare Email Worker
// hits with the raw RFC 822 message.

import PostalMime, { type Address } from "postal-mime";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";
import { getAddressByEmail } from "./addresses";
import { inboundDecision, type AddressMode } from "./rules";

function firstMailbox(a: Address | Address[] | undefined): { address: string; name: string } | null {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  for (const entry of list) {
    if (entry.address) return { address: entry.address, name: entry.name };
    if (entry.group?.length) return { address: entry.group[0].address, name: entry.group[0].name };
  }
  return null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function attachmentSize(content: ArrayBuffer | Uint8Array | string): number {
  if (typeof content === "string") return content.length;
  return content.byteLength;
}

/** Postgres text can't hold NUL bytes; strip them from parsed bodies. */
function clean(s: string | undefined | null): string | null {
  if (!s) return null;
  return s.replace(/\u0000/g, "");
}

export type InboundResult = {
  stored: boolean;
  messageId: string | null;
  forwardTo: string | null;
};

export async function receiveInbound(opts: {
  raw: Buffer;
  envelopeTo: string;
  envelopeFrom: string | null;
  rawSize: number | null;
  truncated: boolean;
}): Promise<InboundResult> {
  const to = opts.envelopeTo.trim().toLowerCase();
  const addr = await getAddressByEmail(to);
  const decision = inboundDecision(
    addr
      ? { mode: addr.mode as AddressMode, forwardTo: addr.forwardTo, enabled: addr.enabled }
      : null
  );
  if (!decision.store) {
    return { stored: false, messageId: null, forwardTo: decision.forwardTo };
  }

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>> | null = null;
  try {
    parsed = await PostalMime.parse(opts.raw);
  } catch (err) {
    console.error("[mail] parse failed", err);
  }

  const from = firstMailbox(parsed?.from);
  const replyTo = firstMailbox(parsed?.replyTo);
  const textBody = opts.truncated
    ? `[This message was too large for the site inbox (${Math.round(
        (opts.rawSize ?? 0) / 1024 / 1024
      )} MB). Only its headers reached the site; the full message was forwarded to your fallback address.]`
    : clean(parsed?.text);

  const [row] = await db
    .insert(emailMessages)
    .values({
      addressId: addr?.id ?? null,
      toAddress: to,
      fromAddress: from?.address ?? opts.envelopeFrom,
      fromName: clean(from?.name) || null,
      replyTo: replyTo?.address ?? null,
      subject: clean(parsed?.subject),
      messageIdHeader: parsed?.messageId ?? null,
      sentAt: parseDate(parsed?.date),
      textBody,
      htmlBody: opts.truncated ? null : clean(parsed?.html),
      attachments: (parsed?.attachments ?? []).map((a) => ({
        filename: a.filename ?? "attachment",
        mimeType: a.mimeType,
        size: attachmentSize(a.content),
      })),
      rawBase64: opts.raw.toString("base64"),
      rawSize: opts.rawSize ?? opts.raw.length,
      truncated: opts.truncated,
      forwardedTo: decision.forwardTo,
    })
    .returning({ id: emailMessages.id });

  return { stored: true, messageId: row.id, forwardTo: decision.forwardTo };
}

/** Re-parse a stored message to pull out one attachment by index. */
export async function extractAttachment(
  rawBase64: string,
  index: number
): Promise<{ filename: string; mimeType: string; content: Uint8Array } | null> {
  const parsed = await PostalMime.parse(Buffer.from(rawBase64, "base64"));
  const a = parsed.attachments[index];
  if (!a) return null;
  const content =
    typeof a.content === "string"
      ? new Uint8Array(Buffer.from(a.content, a.encoding === "base64" ? "base64" : "utf8"))
      : a.content instanceof Uint8Array
        ? a.content
        : new Uint8Array(a.content);
  return { filename: a.filename ?? `attachment-${index + 1}`, mimeType: a.mimeType, content };
}
