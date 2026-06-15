import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts, type PostType } from "@/lib/posts";
import PostCard from "@/components/PostCard";

// PostCard queries live item counts. Match the per-haul page's behavior.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Journal",
  description:
    "Recent hauls, live show announcements, and picker travel from Found in Alabama.",
};

const filters: { label: string; value: PostType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Hauls", value: "haul" },
  { label: "Live shows", value: "live-sale" },
  { label: "Travel", value: "travel" },
];

export default function JournalIndex({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const activeFilter = (searchParams?.type ?? "all") as PostType | "all";
  const allPosts = getAllPosts();
  const posts =
    activeFilter === "all"
      ? allPosts
      : allPosts.filter((p) => p.type === activeFilter);

  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Journal
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-6">
          Hauls, <span className="marker-highlight">live shows,</span>
          <br />
          and where we're headed.
        </h1>
        <p className="text-lg text-brand-ink/80 max-w-prose leading-relaxed">
          Stories from the estates we pack out, announcements for upcoming
          Whatnot shows, and the dates we'll be in your area for picker
          appointments.
        </p>
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-6">
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((f) => {
              const isActive = activeFilter === f.value;
              const href = f.value === "all" ? "/journal" : `/journal?type=${f.value}`;
              return (
                <Link
                  key={f.value}
                  href={href}
                  className={
                    "px-4 py-2 rounded-md text-sm font-medium transition-colors " +
                    (isActive
                      ? "bg-brand-ink text-brand-paper"
                      : "border border-brand-ink/15 hover:border-brand-ink hover:bg-brand-ink/5")
                  }
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </div>
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
