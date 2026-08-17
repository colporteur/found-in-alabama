// GET /robots.txt — host-aware. One app serves two sites, so the robots
// policy depends on which domain is asking:
//  - theephemeralstate.com: index everything public, TES sitemap.
//  - foundinalabama.com: as before, but ALSO disallow /tes — that's the
//    TES preview path, and letting Google index it would create duplicate
//    content competing with the real TES domain (which pages also guard
//    against via canonical tags).

import { NextRequest, NextResponse } from "next/server";
import { isTesHostName } from "@/lib/tes/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const tes = isTesHostName(req.headers.get("host"));
  const base = tes
    ? "https://theephemeralstate.com"
    : "https://www.foundinalabama.com";

  const lines = [
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
