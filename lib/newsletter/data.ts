// Collects the FACTS Claude will draft the newsletter from. The
// emphasis is on never inventing anything — every claim Claude makes
// in the final newsletter should trace back to one of these rows.

import { db, items, ebaySales } from "@/db";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getAllPosts, displayLocation, type Post } from "@/lib/posts";

export type HaulFact = {
  slug: string;
  title: string;
  date: string;
  location: string | null;
  excerpt: string;
  body: string;
  heroImage: string | null;
  url: string;
  itemCount: number;
  activeCount: number;
  soldCount: number;
};

export type ItemFact = {
  id: string;
  slug: string | null;
  title: string;
  heroImage: string | null;
  price: string | null;
  status: "active" | "sold";
  soldOnMarketplace: string | null;
  soldAt: string | null;
  marketplaceUrls: Record<string, string>;
  productUrl: string;
  /** From the haul this came out of, if linked. */
  haulSlug: string | null;
  haulTitle: string | null;
};

export type SaleFact = {
  id: string;
  saleType: string;
  name: string;
  description: string | null;
  discountPercent: string | null;
  minSpendAmount: string | null;
  scope: Record<string, unknown>;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type NewsletterFacts = {
  /** Window the newsletter covers, used for "last 30 days" semantics. */
  windowDays: number;
  windowSince: string;
  recentHauls: HaulFact[];
  featuredActiveItems: ItemFact[];
  recentlySoldItems: ItemFact[];
  activeSales: SaleFact[];
  upcomingSales: SaleFact[];
  /** "Anniston, Alabama" / "central Alabama" — most recent haul's location.
   *  Used as a soft hint to Claude for the "Found in ..." voice. */
  defaultLocationHint: string | null;
};

const SITE_URL = "https://www.foundinalabama.com";
const DEFAULT_WINDOW_DAYS = 30;
const MAX_HAULS = 5;
const MAX_FEATURED_ACTIVE = 12;
const MAX_RECENTLY_SOLD = 8;

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<\/(p|h\d|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function haulIsRecent(p: Post, sinceMs: number): boolean {
  if (p.type !== "haul" || !p.date) return false;
  const t = new Date(p.date).getTime();
  return !isNaN(t) && t >= sinceMs;
}

export async function collectNewsletterFacts({
  windowDays = DEFAULT_WINDOW_DAYS,
}: { windowDays?: number } = {}): Promise<NewsletterFacts> {
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const since = new Date(sinceMs);

  // ── Hauls in the window ─────────────────────────────────────────────
  const allPosts = getAllPosts();
  const haulPosts = allPosts
    .filter((p) => haulIsRecent(p, sinceMs))
    .slice(0, MAX_HAULS);

  // Counts per haul, in one query
  const haulSlugs = haulPosts.map((p) => p.slug);
  const countsBySlug = new Map<string, { active: number; sold: number; total: number }>();
  if (haulSlugs.length > 0) {
    const countRows = await db
      .select({
        slug: items.haulPostSlug,
        active: sql<number>`count(*) filter (where ${items.status} = 'active')`,
        sold: sql<number>`count(*) filter (where ${items.status} = 'sold')`,
        total: sql<number>`count(*)`,
      })
      .from(items)
      .where(inArray(items.haulPostSlug, haulSlugs))
      .groupBy(items.haulPostSlug);
    for (const r of countRows) {
      if (!r.slug) continue;
      countsBySlug.set(r.slug, {
        active: Number(r.active),
        sold: Number(r.sold),
        total: Number(r.total),
      });
    }
  }

  const recentHauls: HaulFact[] = haulPosts.map((p) => {
    const c = countsBySlug.get(p.slug) ?? { active: 0, sold: 0, total: 0 };
    return {
      slug: p.slug,
      title: p.title,
      date: p.date,
      location: displayLocation(p),
      excerpt: p.excerpt ?? "",
      body: stripHtml(p.contentHtml).slice(0, 1200),
      heroImage: p.hero ?? null,
      url: `${SITE_URL}/journal/${p.slug}`,
      itemCount: c.total,
      activeCount: c.active,
      soldCount: c.sold,
    };
  });

  // ── Featured active items ───────────────────────────────────────────
  const activeRows = await db
    .select({
      id: items.id,
      slug: items.slug,
      title: items.title,
      heroImage: items.heroImage,
      price: items.price,
      status: items.status,
      soldOnMarketplace: items.soldOnMarketplace,
      soldAt: items.soldAt,
      marketplaceUrls: items.marketplaceUrls,
      haulPostSlug: items.haulPostSlug,
      capturedAt: items.capturedAt,
    })
    .from(items)
    .where(and(eq(items.status, "active"), isNotNull(items.heroImage)))
    .orderBy(desc(items.capturedAt))
    .limit(MAX_FEATURED_ACTIVE);

  const haulTitleBySlug = new Map(
    allPosts.filter((p) => p.type === "haul").map((p) => [p.slug, p.title])
  );

  const featuredActiveItems: ItemFact[] = activeRows.map((r) => ({
    id: r.id,
    slug: r.slug ?? null,
    title: r.title,
    heroImage: r.heroImage,
    price: r.price,
    status: r.status as "active",
    soldOnMarketplace: null,
    soldAt: null,
    marketplaceUrls: (r.marketplaceUrls as Record<string, string>) ?? {},
    productUrl: `${SITE_URL}/products/${r.slug ?? r.id}`,
    haulSlug: r.haulPostSlug,
    haulTitle: r.haulPostSlug ? haulTitleBySlug.get(r.haulPostSlug) ?? null : null,
  }));

  // ── Recently sold items ─────────────────────────────────────────────
  const soldRows = await db
    .select({
      id: items.id,
      slug: items.slug,
      title: items.title,
      heroImage: items.heroImage,
      price: items.price,
      status: items.status,
      soldOnMarketplace: items.soldOnMarketplace,
      soldAt: items.soldAt,
      marketplaceUrls: items.marketplaceUrls,
      haulPostSlug: items.haulPostSlug,
    })
    .from(items)
    .where(and(eq(items.status, "sold"), gte(items.soldAt, since)))
    .orderBy(desc(items.soldAt))
    .limit(MAX_RECENTLY_SOLD);

  const recentlySoldItems: ItemFact[] = soldRows.map((r) => ({
    id: r.id,
    slug: r.slug ?? null,
    title: r.title,
    heroImage: r.heroImage,
    price: r.price,
    status: r.status as "sold",
    soldOnMarketplace: r.soldOnMarketplace,
    soldAt: r.soldAt ? new Date(r.soldAt).toISOString().slice(0, 10) : null,
    marketplaceUrls: (r.marketplaceUrls as Record<string, string>) ?? {},
    productUrl: `${SITE_URL}/products/${r.slug ?? r.id}`,
    haulSlug: r.haulPostSlug,
    haulTitle: r.haulPostSlug ? haulTitleBySlug.get(r.haulPostSlug) ?? null : null,
  }));

  // ── Sales (active + upcoming) ───────────────────────────────────────
  const saleRows = await db
    .select()
    .from(ebaySales)
    .where(inArray(ebaySales.status, ["RUNNING", "SCHEDULED"]))
    .orderBy(ebaySales.startsAt);

  function toSaleFact(r: (typeof saleRows)[number]): SaleFact {
    return {
      id: r.id,
      saleType: r.saleType,
      name: r.name,
      description: r.description,
      discountPercent: r.discountPercent,
      minSpendAmount: r.minSpendAmount,
      scope: (r.scope as Record<string, unknown>) ?? {},
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
    };
  }

  const activeSales = saleRows
    .filter((r) => r.status === "RUNNING")
    .map(toSaleFact);
  const upcomingSales = saleRows
    .filter((r) => r.status === "SCHEDULED")
    .map(toSaleFact);

  const defaultLocationHint =
    recentHauls.find((h) => !!h.location)?.location ?? "Alabama";

  return {
    windowDays,
    windowSince: since.toISOString(),
    recentHauls,
    featuredActiveItems,
    recentlySoldItems,
    activeSales,
    upcomingSales,
    defaultLocationHint,
  };
}
