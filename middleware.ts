// Edge middleware: NextAuth session gating for /admin (unchanged) plus
// hostname routing for The Ephemeral State (theephemeralstate.com).
//
// TES requests are internally rewritten into the /tes route tree, so the
// visitor sees clean URLs (theephemeralstate.com/shop/postcards) while the
// code lives at app/(tes)/tes/*. The FIA site is untouched — its routes
// only render on non-TES hosts, and /tes/* stays directly reachable on
// foundinalabama.com for previewing before DNS cutover.

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

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  if (isTesHost(req.headers.get("host")) && !pathname.startsWith("/tes")) {
    const url = nextUrl.clone();
    url.pathname = pathname === "/" ? "/tes" : `/tes${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
});

export const config = {
  // Everything except API routes, Next internals, and static files
  // (anything with a dot: images, manifest, favicon, fonts, …).
  // /admin auth gating still applies via authConfig's `authorized`.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
