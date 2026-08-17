// Admin page for generating social copy.
//
// Server component: loads the list of selectable sources (hauls + recent
// active items) and hands them to the client picker, which handles the
// generation flow and renders SocialDraftCard for each result.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllPosts } from "@/lib/posts";
import { db, items } from "@/db";
import { desc, eq } from "drizzle-orm";
import SocialGeneratorClient, {
  type HaulOption,
  type ItemOption,
} from "./SocialGeneratorClient";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  // Hauls — every published journal post of type "haul"
  const hauls: HaulOption[] = getAllPosts()
    .filter((p) => p.type === "haul")
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      hero: p.hero ?? null,
    }));

  // Items — recent active rows, capped so we don't blast the page
  const itemRows = await db
    .select({
      id: items.id,
      title: items.title,
      heroImage: items.heroImage,
      price: items.price,
      haulPostSlug: items.haulPostSlug,
      capturedAt: items.capturedAt,
    })
    .from(items)
    .where(eq(items.status, "active"))
    .orderBy(desc(items.capturedAt))
    .limit(50);

  const itemOptions: ItemOption[] = itemRows.map((r) => ({
    id: r.id,
    title: r.title,
    heroImage: r.heroImage,
    price: r.price,
    haulSlug: r.haulPostSlug,
    capturedAt:
      r.capturedAt instanceof Date
        ? r.capturedAt.toISOString()
        : (r.capturedAt as string),
  }));

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Generate
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Social copy
          </h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Pick a haul or an item, choose the channels you want, click Generate.
        Claude returns one tailored draft per channel — Instagram-style on Instagram,
        keyword-dense on Pinterest, punchy on X, and so on. Voice is anchored to your
        most recent journal posts so it sounds like you, not a brand.
      </p>

      <SocialGeneratorClient hauls={hauls} items={itemOptions} />
    </section>
  );
}
