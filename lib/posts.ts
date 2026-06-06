import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

const postsDir = path.join(process.cwd(), "content/posts");

export type PostType = "haul" | "live-sale" | "travel";

export type MarketplaceKey =
  | "ebay"
  | "etsy"
  | "poshmark"
  | "mercari"
  | "depop"
  | "whatnot";

export type ItemEntry = {
  title: string;
  image?: string;
  links: Partial<Record<MarketplaceKey, string>>;
  sold?: boolean;
};

export type Post = {
  slug: string;
  title: string;
  date: string;            // ISO yyyy-mm-dd
  type: PostType;
  hero?: string;
  /** Additional photos rendered as a gallery between body and items. */
  gallery?: string[];
  excerpt?: string;
  featured?: boolean;
  contentHtml: string;
  // haul-only
  items?: ItemEntry[];
  // live-sale-only
  streamDate?: string;     // ISO datetime
  streamUrl?: string;
  // travel-only
  city?: string;
  dateStart?: string;      // ISO yyyy-mm-dd
  dateEnd?: string;        // ISO yyyy-mm-dd
};

const TYPE_LABELS: Record<PostType, string> = {
  haul: "Haul",
  "live-sale": "Live show",
  travel: "Travel",
};

export function typeLabel(type: PostType): string {
  return TYPE_LABELS[type];
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(postsDir)) return [];
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md"));
  const posts = files.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(postsDir, file), "utf-8");
    const { data, content } = matter(raw);
    const contentHtml = marked.parse(content) as string;
    return {
      slug,
      contentHtml,
      title: data.title ?? slug,
      date: data.date ?? "",
      type: (data.type ?? "haul") as PostType,
      hero: data.hero,
      gallery: Array.isArray(data.gallery) ? data.gallery : undefined,
      excerpt: data.excerpt,
      featured: Boolean(data.featured),
      items: data.items,
      streamDate: data.streamDate,
      streamUrl: data.streamUrl,
      city: data.city,
      dateStart: data.dateStart,
      dateEnd: data.dateEnd,
    } as Post;
  });
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPost(slug: string): Post | undefined {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getRecentPosts(limit = 3): Post[] {
  return getAllPosts().slice(0, limit);
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
