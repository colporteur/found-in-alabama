// /admin/mail — the site inbox for addresses set to "Site inbox" or
// "Site inbox + forward". Filter by address; archived mail is one click
// away. No delete — everything is kept.

import Link from "next/link";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailAddresses, emailMessages } from "@/db/schema";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function fmt(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    ...(sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }),
  });
}

export default async function MailInboxPage({
  searchParams,
}: {
  searchParams: { to?: string; view?: string; page?: string };
}) {
  const archived = searchParams.view === "archived";
  const to = searchParams.to?.toLowerCase() || null;
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where = and(
    archived ? isNotNull(emailMessages.archivedAt) : isNull(emailMessages.archivedAt),
    to ? eq(emailMessages.toAddress, to) : undefined
  );

  const [messages, [totalRow], addresses, unreadByTo] = await Promise.all([
    db
      .select({
        id: emailMessages.id,
        toAddress: emailMessages.toAddress,
        fromAddress: emailMessages.fromAddress,
        fromName: emailMessages.fromName,
        subject: emailMessages.subject,
        receivedAt: emailMessages.receivedAt,
        readAt: emailMessages.readAt,
        attachments: emailMessages.attachments,
        textBody: emailMessages.textBody,
      })
      .from(emailMessages)
      .where(where)
      .orderBy(desc(emailMessages.receivedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ count: count() }).from(emailMessages).where(where),
    db
      .select({ address: emailAddresses.address, mode: emailAddresses.mode })
      .from(emailAddresses)
      .orderBy(emailAddresses.address),
    db
      .select({ to: emailMessages.toAddress, count: count() })
      .from(emailMessages)
      .where(and(isNull(emailMessages.readAt), isNull(emailMessages.archivedAt)))
      .groupBy(emailMessages.toAddress),
  ]);

  const unread = new Map(unreadByTo.map((r) => [r.to, r.count]));
  const totalUnread = unreadByTo.reduce((s, r) => s + r.count, 0);
  const inboxAddresses = addresses.filter((a) => a.mode !== "forward").map((a) => a.address);
  // Show filters for inbox addresses plus any recipient that has unread mail.
  const filterList = [...new Set([...inboxAddresses, ...unread.keys()])].sort();
  const total = totalRow?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (p: { to?: string | null; view?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const t = p.to === undefined ? to : p.to;
    const v = p.view === undefined ? (archived ? "archived" : null) : p.view;
    if (t) q.set("to", t);
    if (v) q.set("view", v);
    if (p.page && p.page > 1) q.set("page", String(p.page));
    const s = q.toString();
    return `/admin/mail${s ? `?${s}` : ""}`;
  };

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">Mail</p>
          <h1 className="font-marker text-3xl md:text-4xl">
            {archived ? "Archived" : "Inbox"}
            {!archived && totalUnread > 0 && (
              <span className="ml-3 text-xl align-middle text-brand-earth">{totalUnread} unread</span>
            )}
          </h1>
        </div>
        <Link
          href="/admin/mail/addresses"
          className="px-4 py-2 rounded-md bg-brand-ink text-white text-sm font-medium"
        >
          Manage addresses →
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 text-sm">
        <Link
          href={href({ to: null, page: 1 })}
          className={`px-3 py-1.5 rounded-full border ${
            !to ? "bg-brand-yellow border-brand-yellow" : "border-brand-ink/20 bg-white"
          }`}
        >
          All addresses
        </Link>
        {filterList.map((a) => (
          <Link
            key={a}
            href={href({ to: a, page: 1 })}
            className={`px-3 py-1.5 rounded-full border ${
              to === a ? "bg-brand-yellow border-brand-yellow" : "border-brand-ink/20 bg-white"
            }`}
          >
            {a}
            {unread.get(a) ? <strong className="ml-1">({unread.get(a)})</strong> : null}
          </Link>
        ))}
        <span className="mx-1 text-brand-ink/30">|</span>
        <Link
          href={href({ view: archived ? null : "archived", page: 1 })}
          className="px-3 py-1.5 rounded-full border border-brand-ink/20 bg-white"
        >
          {archived ? "← Back to inbox" : "Archived"}
        </Link>
      </div>

      {messages.length === 0 ? (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-8 text-center text-brand-ink/60 max-w-3xl">
          {archived ? "Nothing archived." : "No mail here yet."}
          {!archived && inboxAddresses.length === 0 && (
            <p className="mt-2 text-sm">
              <Link href="/admin/mail/addresses" className="underline">
                Create an address
              </Link>{" "}
              set to &ldquo;Site inbox&rdquo; to start receiving mail here.
            </p>
          )}
        </div>
      ) : (
        <ul className="bg-white border border-brand-ink/15 rounded-lg divide-y divide-brand-ink/10 max-w-5xl">
          {messages.map((m) => {
            const isUnread = !m.readAt;
            const preview = (m.textBody ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
            return (
              <li key={m.id}>
                <Link
                  href={`/admin/mail/${m.id}`}
                  className={`block px-4 py-3 hover:bg-brand-paper ${isUnread ? "" : "text-brand-ink/70"}`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p className={`truncate ${isUnread ? "font-semibold" : ""}`}>
                      {isUnread && (
                        <span className="inline-block w-2 h-2 rounded-full bg-brand-yellow-dark mr-2 align-middle" />
                      )}
                      {m.fromName || m.fromAddress || "(unknown sender)"}
                    </p>
                    <p className="text-xs text-brand-ink/50 whitespace-nowrap">
                      {fmt(m.receivedAt)}
                    </p>
                  </div>
                  <p className={`truncate text-sm ${isUnread ? "font-medium" : ""}`}>
                    {m.subject || "(no subject)"}
                    {m.attachments.length > 0 && (
                      <span className="text-brand-ink/50"> · 📎 {m.attachments.length}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-brand-ink/50">
                    to {m.toAddress}
                    {preview && ` — ${preview}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-4 mt-6 text-sm">
          {page > 1 && <Link href={href({ page: page - 1 })}>← Newer</Link>}
          <span className="text-brand-ink/50">
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={href({ page: page + 1 })}>Older →</Link>}
        </div>
      )}
    </section>
  );
}
