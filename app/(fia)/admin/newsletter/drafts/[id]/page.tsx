// Server wrapper for the editor — loads the draft from the DB and hands
// it to the client form. Editor is for refining subject lines + the
// markdown body of each flavor before sending in Phase 4C.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { db, newsletterDrafts } from "@/db";
import { eq } from "drizzle-orm";
import DraftEditor, { type InitialDraft } from "./DraftEditor";

export const dynamic = "force-dynamic";

export default async function EditDraftPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const [row] = await db
    .select()
    .from(newsletterDrafts)
    .where(eq(newsletterDrafts.id, params.id))
    .limit(1);
  if (!row) notFound();

  const initial: InitialDraft = {
    id: row.id,
    label: row.label,
    status: row.status,
    emailSubject: row.emailSubject,
    ebaySubject: row.ebaySubject,
    emailBody: row.emailBody,
    ebayBody: row.ebayBody,
    emailRecipientCount: row.emailRecipientCount ?? null,
    generatedAt:
      row.generatedAt instanceof Date
        ? row.generatedAt.toISOString()
        : (row.generatedAt as string),
    sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
  };

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Edit newsletter
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">{initial.label}</h1>
          <p className="text-xs text-brand-ink/55 mt-1">
            Generated {new Date(initial.generatedAt).toLocaleString()}
            {initial.emailRecipientCount != null
              ? ` · ${initial.emailRecipientCount} confirmed subscriber${initial.emailRecipientCount === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href="/admin/newsletter/drafts"
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
          >
            ← All drafts
          </Link>
        </div>
      </div>
      <DraftEditor initial={initial} />
    </section>
  );
}
