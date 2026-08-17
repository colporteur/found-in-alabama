// Admin index of saved haul drafts. Lists every draft, lets you open it for
// further editing in /admin/draft?id=N, or delete it.

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db, haulDrafts } from "@/db";
import DraftsList, { type DraftSummary } from "./DraftsList";

export const dynamic = "force-dynamic";

export default async function AdminDraftsPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const rows = await db
    .select()
    .from(haulDrafts)
    .orderBy(desc(haulDrafts.updatedAt))
    .limit(200);

  const drafts: DraftSummary[] = rows.map((r) => {
    const firstPhoto = r.heroImages[0] ?? r.contextImages[0] ?? null;
    return {
      id: r.id,
      label: r.label,
      heroCount: r.heroImages.length,
      contextCount: r.contextImages.length,
      hasNarrative: !!(r.title || r.body),
      title: r.title,
      acquisitionContext: r.acquisitionContext,
      previewSrc: firstPhoto
        ? `data:${firstPhoto.mediaType};base64,${firstPhoto.base64}`
        : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return <DraftsList drafts={drafts} />;
}
