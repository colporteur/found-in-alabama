// Edge-safe middleware. Uses authConfig directly (no DB imports) so
// session verification works at the edge runtime. The `authorized`
// callback in authConfig decides which routes require sign-in.

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/admin/:path*"],
};
