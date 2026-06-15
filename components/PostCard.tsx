// Card used on the home page and journal index. For haul posts, queries
// the items table by haul_post_slug to surface live availability counts
// and a small strip of item thumbnails directly on the card. Non-haul
// posts render as before — the items query returns an empty set so the
// footer block is skipped.

import Link from "next/link";
import { db, items as itemsTable } from "@/db";
import { eq, desc } from "drizzle-orm";
import { type Post, typeLabel, formatDate } from "@/lib/posts";

const MAX_THUMBS = 5;

export default async function PostCard({ post }: { post: Post }) {
  // Pull items linked to this haul post (haul_post_slug = post.slug).
  // For non-haul posts this is just an empty result set.
  const rows = await db
    .select({
      id: itemsTable.id,
      slug: itemsTable.slug,
      title: itemsTable.title,
      heroImage: itemsTable.heroImage,
      status: itemsTable.status,
    })
    .from(itemsTable)
    .where(eq(itemsTable.haulPostSlug, post.slug))
    .orderBy(desc(itemsTable.capturedAt));

  const activeItems = rows.filter((r) => r.status !== "sold");
  const soldItems = rows.filter((r) => r.status === "sold");
  const total = rows.length;

  // Prefer active items with a hero image for the thumbnail strip;
  // fill remaining slots with sold items if there's room.
  const activeWithImage = activeItems.filter((r) => r.heroImage);
  const soldWithImage = soldItems.filter((r) => r.heroImage);
  const thumbnails = [...activeWithImage, ...soldWithImage].slice(0, MAX_THUMBS);

  return (
    <div className="group block border border-brand-ink/15 rounded-lg overflow-hidden hover:border-brand-yellow transition-colors bg-white">
      {/* Hero + title link to the journal post itself */}
      <Link href={`/journal/${post.slug}`} className="block">
        {post.hero ? (
          <div className="aspect-[16/10] bg-brand-paper overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.hero}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          </div>
        ) : (
          <div className="aspect-[16/10] bg-brand-yellow/20 flex items-center justify-center">
            <span className="font-marker text-2xl text-brand-ink/30">
              {typeLabel(post.type)}
            </span>
          </div>
        )}
        <div className="p-5 pb-3">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            {typeLabel(post.type)}
            <span className="text-brand-ink/40 ml-2">
              · {formatDate(post.date)}
            </span>
          </p>
          <h3 className="font-marker text-2xl mb-2 leading-tight">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="text-sm text-brand-ink/70 leading-relaxed">
              {post.excerpt}
            </p>
          )}
        </div>
      </Link>

      {/* Item counts + thumbnail strip (only when there are captured items
          for this post; non-haul posts and brand-new hauls without a sync
          yet get nothing extra). */}
      {total > 0 && (
        <div className="px-5 pb-5 pt-3 border-t border-brand-ink/10">
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <span className="inline-flex items-baseline gap-1 px-2.5 py-1 bg-brand-yellow/20 text-brand-ink rounded">
              <strong className="font-marker text-base leading-none">
                {activeItems.length}
              </strong>
              <span className="text-brand-ink/70">available</span>
            </span>
            {soldItems.length > 0 && (
              <span className="inline-flex items-baseline gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded">
                <strong className="font-marker text-base leading-none">
                  {soldItems.length}
                </strong>
                <span>sold</span>
              </span>
            )}
          </div>

          {thumbnails.length > 0 && (
            <div className="flex gap-2">
              {thumbnails.map((it) => (
                <Link
                  key={it.id}
                  href={`/products/${it.slug ?? it.id}`}
                  title={it.title}
                  className="block w-12 h-12 rounded overflow-hidden bg-brand-paper hover:ring-2 hover:ring-brand-yellow transition-all shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.heroImage!}
                    alt=""
                    className={
                      "w-full h-full object-cover " +
                      (it.status === "sold" ? "grayscale opacity-70" : "")
                    }
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
