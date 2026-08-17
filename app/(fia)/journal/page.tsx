import type { Metadata } from "next";
import { getAllPosts } from "@/lib/posts";
import PostCard from "@/components/PostCard";

// PostCard queries live item counts. Match the per-haul page's behavior.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Journal",
  description:
    "Recent estate hauls from Found in Alabama — stories from the estates we pack out across Alabama.",
};

export default function JournalIndex() {
  // Hauls-only. Live shows + travel post types are no longer surfaced
  // publicly. The underlying lib/posts.ts still recognizes them, so any
  // legacy markdown files remain readable at their direct URLs.
  const posts = getAllPosts().filter((p) => p.type === "haul");

  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Journal
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-6">
          Estate hauls from <span className="marker-highlight">across Alabama.</span>
        </h1>
        <p className="text-lg text-brand-ink/80 max-w-prose leading-relaxed">
          Stories from the estates we pack out. Each post is a snapshot of
          what came in, where it came from, and what’s heading to our
          marketplaces in the coming weeks.
        </p>
      </section>

      <section className="container-content py-12">
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="font-marker text-2xl text-brand-ink/40 mb-2">
              Nothing here yet.
            </p>
            <p className="text-brand-ink/60">
              First post going up soon — check back, or follow us on social.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {posts.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
