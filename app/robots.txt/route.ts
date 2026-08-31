// GET /robots.txt — host-aware. One app serves two sites, so the robots
// policy depends on which domain is asking:
//  - theephemeralstate.com: index everything public, TES sitemap.
//  - foundinalabama.com: as before, but ALSO disallow /tes — that's the
//    TES preview path, and letting Google index it would create duplicate
//    content competing with the real TES domain (which pages also guard
//    against via canonical tags).
//
// Blocked crawlers (Aug 2026, Fluid CPU overage): SEO-tool scrapers and
// other freeloaders that re-render every page but send us nothing.
// Deliberately NOT blocked: Googlebot/Bingbot (search), and the AI
// answer-engine crawlers (GPTBot, OAI-SearchBot, ClaudeBot, Perplexity,
// Google-Extended, Applebot) — being crawlable there is visibility.
// facebookexternalhit stays allowed too: it builds link previews when
// items are shared on Facebook/Instagram/WhatsApp.

import { NextRequest, NextResponse } from "next/server";
import { isTesHostName } from "@/lib/tes/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Crawlers that give us nothing — blocked from the whole site. */
const BLOCKED_BOTS = [
  "SemrushBot",
  "AhrefsBot",
  "Amazonbot",
  "MJ12bot",
  "DotBot",
  "PetalBot",
  "Bytespider",
];

export function GET(req: NextRequest) {
  const tes = isTesHostName(req.headers.get("host"));
  const base = tes
    ? "https://theephemeralstate.com"
    : "https://www.foundinalabama.com";

  const lines = [
    ...BLOCKED_BOTS.flatMap((bot) => [
      `User-agent: ${bot}`,
      "Disallow: /",
      "",
    ]),
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /api",
    "Disallow: /signin",
    ...(tes ? [] : ["Disallow: /tes"]),
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
