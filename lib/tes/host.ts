// Link prefix helpers for The Ephemeral State pages.
//
// TES pages live at /tes/* in the app tree. On theephemeralstate.com the
// middleware rewrite hides that prefix (theephemeralstate.com/shop/x →
// /tes/shop/x internally), so links are written WITHOUT the /tes prefix.
//
// History: before DNS cutover, tesPrefix() read the request Host header
// and returned "/tes" when previewing on foundinalabama.com/tes. That
// call to headers() forced EVERY TES page to render dynamically on every
// request — crawlers walking ~7,000 item pages became the bulk of the
// Vercel Fluid CPU bill (Sep 2026). The preview path is retired: the
// prefix is now a constant, the pages are ISR-cached, and middleware
// 301s foundinalabama.com/tes/* to the real domain. Local preview uses
// http://tes.localhost:3000 (see middleware.ts).
//
// isTesHostName() is still used by robots.txt / sitemap.xml route
// handlers, which stay dynamic and cheap.

export function isTesHostName(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return (
    h === "theephemeralstate.com" ||
    h === "www.theephemeralstate.com" ||
    h === "tes.localhost"
  );
}

/** Always "" — the rewrite hides /tes on the TES domain. */
export function tesPrefix(): string {
  return "";
}

/** Home link for TES pages. */
export function tesHome(): string {
  return "/";
}
