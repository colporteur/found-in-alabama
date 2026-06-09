// Edit form for one haul post. Server component loads the raw markdown
// + frontmatter from disk and hands it to the client form.

import Link from "next/link";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { readRawPost } from "@/lib/posts-edit";
import EditPostClient, { type InitialPost } from "./EditPostClient";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const raw = readRawPost(params.slug);
  if (!raw) notFound();

  // Read fields off the frontmatter — coerce to the shape the client wants.
  const fm = raw.frontmatter;
  const stringOr = (key: string): string =>
    typeof fm[key] === "string" ? (fm[key] as string) : "";

  const initial: InitialPost = {
    slug: raw.slug,
    title: stringOr("title") || raw.slug,
    date: stringOr("date"),
    excerpt: stringOr("excerpt"),
    body: raw.body,
    featured: Boolean(fm.featured),
    city: stringOr("city"),
    state: stringOr("state"),
    vagueLocation: stringOr("vagueLocation"),
    hero: stringOr("hero"),
    galleryCount: Array.isArray(fm.gallery)
      ? (fm.gallery as unknown[]).length
      : 0,
  };

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Edit
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">{initial.title}</h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href={`/journal/${initial.slug}`}
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            View public ↗
          </Link>
          <Link
            href="/admin/journal"
            className="text-brand-ink/60 hover:text-brand-ink"
          >
            ← All posts
          </Link>
        </div>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Changes commit to the GitHub repo and Vercel auto-rebuilds in about a
        minute. The slug, hero photo, and gallery photos are locked here — they
        require a re-publish (so you don&rsquo;t accidentally break existing
        links).
      </p>

      <EditPostClient initial={initial} />
    </section>
  );
}
