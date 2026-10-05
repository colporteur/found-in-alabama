// /admin/mail/[id] — read one message. Opening it marks it read. HTML
// mail renders in a sandboxed iframe (no scripts, remote images blocked
// until you click "Load images").

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";
import MessageActions from "./MessageActions";
import HtmlBody from "./HtmlBody";

export const dynamic = "force-dynamic";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function MailMessagePage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [m] = await db
    .select({
      id: emailMessages.id,
      toAddress: emailMessages.toAddress,
      fromAddress: emailMessages.fromAddress,
      fromName: emailMessages.fromName,
      replyTo: emailMessages.replyTo,
      subject: emailMessages.subject,
      sentAt: emailMessages.sentAt,
      receivedAt: emailMessages.receivedAt,
      textBody: emailMessages.textBody,
      htmlBody: emailMessages.htmlBody,
      attachments: emailMessages.attachments,
      truncated: emailMessages.truncated,
      forwardedTo: emailMessages.forwardedTo,
      readAt: emailMessages.readAt,
      archivedAt: emailMessages.archivedAt,
    })
    .from(emailMessages)
    .where(eq(emailMessages.id, params.id))
    .limit(1);
  if (!m) notFound();

  if (!m.readAt) {
    await db
      .update(emailMessages)
      .set({ readAt: new Date() })
      .where(eq(emailMessages.id, m.id));
  }

  const when = (m.sentAt ?? m.receivedAt).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const replyAddr = m.replyTo || m.fromAddress;
  const replyHref = replyAddr
    ? `mailto:${encodeURIComponent(replyAddr)}?subject=${encodeURIComponent(
        m.subject?.toLowerCase().startsWith("re:") ? m.subject : `Re: ${m.subject ?? ""}`
      )}`
    : null;

  return (
    <section className="container-content py-12">
      <Link
        href={m.archivedAt ? "/admin/mail?view=archived" : "/admin/mail"}
        className="text-sm text-brand-ink/60 hover:text-brand-ink"
      >
        ← {m.archivedAt ? "Archived" : "Inbox"}
      </Link>

      <div className="bg-white border border-brand-ink/15 rounded-lg mt-4 max-w-5xl">
        <div className="p-5 border-b border-brand-ink/10">
          <h1 className="text-2xl font-semibold mb-3 break-words">
            {m.subject || "(no subject)"}
          </h1>
          <div className="text-sm space-y-0.5">
            <p>
              <span className="text-brand-ink/50">From </span>
              {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}
            </p>
            <p>
              <span className="text-brand-ink/50">To </span>
              {m.toAddress}
            </p>
            {m.replyTo && m.replyTo !== m.fromAddress && (
              <p>
                <span className="text-brand-ink/50">Reply-To </span>
                {m.replyTo}
              </p>
            )}
            <p className="text-brand-ink/50">{when}</p>
            {m.forwardedTo && (
              <p className="text-brand-ink/50">Also forwarded to {m.forwardedTo}</p>
            )}
          </div>
          <div className="mt-4">
            <MessageActions
              id={m.id}
              archived={!!m.archivedAt}
              replyHref={replyHref}
            />
          </div>
        </div>

        {m.truncated && (
          <div className="bg-amber-50 border-b border-amber-200 p-4 text-sm">
            This message was too big for the site inbox. The full copy went to
            the worker&rsquo;s fallback address.
          </div>
        )}

        <div className="p-5">
          {m.htmlBody ? (
            <HtmlBody html={m.htmlBody} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
              {m.textBody || "(empty message)"}
            </pre>
          )}
        </div>

        {m.attachments.length > 0 && (
          <div className="p-5 border-t border-brand-ink/10">
            <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
              Attachments
            </p>
            <ul className="space-y-1 text-sm">
              {m.attachments.map((a, i) => (
                <li key={i}>
                  <a
                    href={`/api/admin/email/messages/${m.id}/attachments/${i}`}
                    className="underline"
                  >
                    📎 {a.filename}
                  </a>{" "}
                  <span className="text-brand-ink/50">
                    {a.mimeType} · {fmtSize(a.size)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
