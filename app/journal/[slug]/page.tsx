import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllPosts,
  getPost,
  typeLabel,
  formatDate,
  type ItemEntry,
} from "@/lib/posts";

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = getPost(params.slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: post.hero ? [{ url: post.hero }] : [],
    },
  };
}

const marketplaceLabels: Record<string, string> = {
  ebay: "eBay",
  etsy: "Etsy",
  poshmark: "Poshmark",
  mercari: "Mercari",
  depop: "Depop",
  whatnot: "Whatnot",
};

function ItemCard({ item }: { item: ItemEntry }) {
  return (
    <div className="border border-brand-ink/15 rounded-lg overflow-hidden bg-white">
      {item.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt=""
          className="w-full aspect-square object-cover"
        />
      )}
      <div className="p-3">
        <p className={"text-sm font-medium mb-2 leading-tight " + (item.sold ? "text-brand-ink/40 line-through" : "")}>
          {item.title}
        </p>
        {item.sold ? (
          <p className="text-xs uppercase tracking-wider text-brand-earth">Sold</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {Object.entries(item.links).map(([key, url]) => (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-1 bg-brand-yellow/30 hover:bg-brand-yellow text-brand-ink rounded transition-colors"
              >
                {marketplaceLabels[key] ?? key}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  return (
    <article className="container-content py-12">
      <Link
        href="/journal"
        className="text-sm text-brand-ink/60 hover:text-brand-ink"
      >
        ← Journal
      </Link>

      <header className="mt-6 mb-8">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          {typeLabel(post.type)}
          <span className="text-brand-ink/40 ml-2">
            · {formatDate(post.date)}
          </span>
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight">
          {post.title}
        </h1>
      </header>

      {post.hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.hero}
          alt=""
          className="w-full rounded-lg mb-8 max-h-[500px] object-cover"
        />
      )}

      <div
        className="prose-fia max-w-prose mb-12"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
      />

      {post.type === "haul" && post.items && post.items.length > 0 && (
        <section className="mt-12 pt-8 border-t border-brand-ink/10">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            From this haul
          </p>
          <h2 className="font-marker text-2xl md:text-3xl mb-6">
            Items currently listed
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {post.items.map((item, i) => (
              <ItemCard key={i} item={item} />
            ))}
          </div>
        </section>
      )}

      {post.type === "live-sale" && (
        <section className="mt-12 pt-8 border-t border-brand-ink/10 bg-brand-yellow -mx-6 px-6 py-8 rounded-lg">
          <p className="text-xs uppercase tracking-wider text-brand-ink/70 mb-2">
            Tune in
          </p>
          {post.streamDate && (
            <p className="font-marker text-2xl mb-3">
              {new Date(post.streamDate).toLocaleString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </p>
          )}
          {post.streamUrl && (
            <a
              href={post.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-6 py-3 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors"
            >
              Watch on Whatnot →
            </a>
          )}
        </section>
      )}

      {post.type === "travel" && (
        <section className="mt-12 pt-8 border-t border-brand-ink/10 bg-brand-yellow -mx-6 px-6 py-8 rounded-lg">
          <p className="text-xs uppercase tracking-wider text-brand-ink/70 mb-2">
            Where & when
          </p>
          <p className="font-marker text-2xl mb-2">
            {post.city}
          </p>
          <p className="text-brand-ink/80 mb-4">
            {formatDate(post.dateStart)}
            {post.dateEnd && post.dateEnd !== post.dateStart
              ? ` – ${formatDate(post.dateEnd)}`
              : ""}
          </p>
          <a
            href="sms:+12566841253"
            className="inline-flex items-center justify-center px-6 py-3 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors"
          >
            Text us to set up an appointment →
          </a>
        </section>
      )}

      <div className="mt-16 pt-8 border-t border-brand-ink/10">
        <Link
          href="/journal"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to journal
        </Link>
      </div>
    </article>
  );
}
