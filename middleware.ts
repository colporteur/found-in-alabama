// Edge middleware: NextAuth session gating for /admin (unchanged) plus
// hostname routing for The Ephemeral State (theephemeralstate.com).
//
// TES requests are internally rewritten into the /tes route tree, so the
// visitor sees clean URLs (theephemeralstate.com/shop/postcards) while the
// code lives at app/(tes)/tes/*. The FIA site is untouched — its routes
// only render on non-TES hosts.
//
// The /tes/* preview path on foundinalabama.com is retired (Sep 2026):
// TES links no longer carry a host-dependent prefix (lib/tes/host.ts), so
// that path would serve pages whose links point at the FIA shop. Any hit
// on it now 301s to the real domain, which also consolidates whatever
// crawlers still remember the preview URLs. Local preview:
// http://tes.localhost:3000 (a TES host — rewrite applies as in prod).

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

/** Hostnames that serve The Ephemeral State storefront. */
function isTesHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return (
    h === "theephemeralstate.com" ||
    h === "www.theephemeralstate.com" ||
    h === "tes.localhost" // local testing: http://tes.localhost:3000
  );
}

/**
 * Hostnames that serve Found in Alabama. The preview-path redirect below
 * keys on THIS, not on "not a TES host": after middleware rewrites a TES
 * request to /tes/*, Vercel serves the rewritten request under the
 * deployment's own *.vercel.app hostname, and keying on "not TES" there
 * bounced it straight back to theephemeralstate.com — an infinite 301
 * loop (2026-09-10).
 */
function isFiaHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return h === "foundinalabama.com" || h === "www.foundinalabama.com";
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const host = req.headers.get("host");

  if (isTesHost(host)) {
    if (!pathname.startsWith("/tes")) {
      const url = nextUrl.clone();
      url.pathname = pathname === "/" ? "/tes" : `/tes${pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Retired preview path on the FIA host → the real TES domain.
  // (Static assets under /tes/*.png etc. never reach middleware — the
  // matcher below excludes any path containing a dot. Deployment-URL and
  // localhost requests fall through and serve /tes/* directly.)
  if (
    isFiaHost(host) &&
    (pathname === "/tes" || pathname.startsWith("/tes/"))
  ) {
    const target = new URL(
      pathname === "/tes" ? "/" : pathname.slice("/tes".length),
      "https://theephemeralstate.com"
    );
    target.search = nextUrl.search;
    return NextResponse.redirect(target, 301);
  }

  return NextResponse.next();
});

export const config = {
  // Everything except API routes, Next internals, and static files
  // (anything with a dot: images, manifest, favicon, fonts, …).
  // /admin auth gating still applies via authConfig's `authorized`.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
