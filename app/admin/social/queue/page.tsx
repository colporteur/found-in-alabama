// Admin queue page — list of every saved social draft, organized by
// status and schedule. Server component loads the initial set; the client
// re-fetches after each edit so we always show fresh state.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db, socialDrafts } from "@/db";
import { desc } from "drizzle-orm";
import QueueClient, { type DraftRow } from "./QueueClient";

export const dynamic = "force-dynamic";

export default async function SocialQueuePage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const rows = await db
    .select()
    .from(socialDrafts)
    .orderBy(desc(socialDrafts.createdAt))
    .limit(500);

  // Drizzle returns Date objects for timestamps; serialize for the client.
  const serialized: DraftRow[] = rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    sourceTitle: r.sourceTitle,
    sourceImage: r.sourceImage,
    generationId: r.generationId,
    contentType: r.contentType,
    channel: r.channel,
    content: r.content as Record<string, unknown>,
    status: r.status,
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    postedAt: r.postedAt ? r.postedAt.toISOString() : null,
    notes: r.notes,
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : (r.createdAt as string),
    updatedAt:
      r.updatedAt instanceof Date
        ? r.updatedAt.toISOString()
        : (r.updatedAt as string),
  }));

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Queue
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Social posts
          </h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href="/admin/social"
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
          >
            ← Generate new
          </Link>
          <Link
            href="/admin"
            className="text-brand-ink/60 hover:text-brand-ink"
          >
            Dashboard
          </Link>
        </div>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Drafts you&rsquo;ve saved. Schedule a time, edit the text, mark as posted, or
        delete. Posts in the &ldquo;Due today&rdquo; section are what you should
        publish next.
      </p>

      <QueueClient initialDrafts={serialized} />
    </section>
  );
}
