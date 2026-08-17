import Link from "next/link";
import { marketplaces, contact } from "@/lib/links";
import { getRecentPosts } from "@/lib/posts";
import PostCard from "@/components/PostCard";

// PostCard queries live item counts from the DB. Without this, Next
// statically generates the home page at build time and the
// available/sold chips never refresh between deploys.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const recentPosts = getRecentPosts(6);
  return (
    <>
      {/* Hero — compact, lets the journal sit higher */}
      <section className="container-content pt-8 pb-6 md:pt-10 md:pb-8">
        <h1 className="font-marker text-3xl md:text-4xl leading-tight mb-3">
          Estate finds, books, and small antiques —{" "}
          <span className="marker-highlight">found in Alabama.</span>
        </h1>
        <p className="text-base md:text-lg text-brand-ink/75 leading-snug mb-5 max-w-2xl">
          If you collect it, we sell it. Come check out what we&rsquo;ve found.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/shop" className="btn-primary">
            Shop the inventory →
          </Link>
          <Link href="/we-buy" className="btn-secondary">
            We buy estates &amp; collections
          </Link>
        </div>
      </section>

      {/* Latest from the journal */}
      {recentPosts.length > 0 && (
        <section className="container-content pt-6 pb-16">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Latest from the journal
              </p>
              <h2 className="font-marker text-3xl md:text-4xl">
                What we've been finding.
              </h2>
            </div>
            <Link
              href="/journal"
              className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              See all →
            </Link>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {recentPosts.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </section>
      )}

      {/* Marketplaces strip */}
      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-16">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            Where to find them
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-8">
            Find our hauls here.
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {marketplaces.map((m) => (
              <a
                key={m.name}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block border border-brand-ink/15 rounded-lg p-4 hover:border-brand-yellow hover:bg-brand-yellow/10 transition-colors"
              >
                <p className="font-medium text-base">{m.name}</p>
                <p className="text-xs text-brand-ink/60 mt-1">{m.handle}</p>
              </a>
            ))}
          </div>
          <p className="text-sm text-brand-ink/60 mt-6">
            See all of our profiles on the{" "}
            <Link
              href="/find-me"
              className="underline decoration-brand-yellow decoration-2 underline-offset-4"
            >
              Find me
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-brand-yellow">
        <div className="container-content py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-marker text-3xl md:text-4xl mb-2">
              Got an estate or collection?
            </h2>
            <p className="text-brand-ink/80">
              Text us. We answer fast and we travel statewide.
            </p>
          </div>
          <a
            href={contact.smsHref}
            className="inline-flex items-center justify-center px-7 py-4 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors text-lg"
          >
            Text {contact.phone} →
          </a>
        </div>
      </section>
    </>
  );
}
