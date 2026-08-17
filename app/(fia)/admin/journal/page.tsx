// Admin landing page for managing haul posts. Lists every haul with
// quick links to view (public page) and edit.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllPosts, displayLocation, formatDate } from "@/lib/posts";

export const dynamic = "force-dynamic";

export default async function AdminJournalPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const hauls = getAllPosts().filter((p) => p.type === "haul");

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Manage
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">Journal posts</h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href="/admin/draft"
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
          >
            ← Draft new
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
        Every haul post you&rsquo;ve published. Click <strong>Edit</strong> to
        change the title, date, body text, location, or featured flag. Photos
        aren&rsquo;t editable here yet — re-publish if you need to swap them.
      </p>

      {hauls.length === 0 ? (
        <p className="text-sm text-brand-ink/60 italic">
          No haul posts yet.{" "}
          <Link
            href="/admin/draft"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            Draft one →
          </Link>
        </p>
      ) : (
        <div className="border border-brand-ink/15 rounded-lg bg-white overflow-hidden divide-y divide-brand-ink/10">
          {hauls.map((p) => {
            const loc = displayLocation(p);
            return (
              <div
                key={p.slug}
                className="flex items-center gap-4 p-4 hover:bg-brand-paper/50 transition-colors"
              >
                {p.hero ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.hero}
                    alt=""
                    className="w-16 h-16 object-cover rounded shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 bg-brand-paper rounded shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{p.title}</p>
                  <p className="text-xs text-brand-ink/55 mt-0.5">
                    {formatDate(p.date)}
                    {loc ? <> · Found in {loc}</> : null}
                    {p.featured ? (
                      <span className="ml-2 text-brand-earth uppercase tracking-wider">
                        · featured
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/journal/${p.slug}`}
                    className="text-xs px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors"
                  >
                    View
                  </Link>
                  <Link
                    href={`/admin/journal/${p.slug}/edit`}
                    className="text-xs px-3 py-1.5 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors"
                  >
                    Edit
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
