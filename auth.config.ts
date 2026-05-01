// Edge-safe auth config — no DB imports, no provider implementations.
// Used by middleware (which runs at the edge) and by auth.ts.

import type { NextAuthConfig } from "next-auth";

const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();

export const authConfig = {
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
  // Providers are added in auth.ts, not here. Middleware doesn't need
  // access to provider implementations to check sessions.
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
  callbacks: {
    // Runs on every request hitting a protected route. Must return true
    // for the request to pass through; false redirects to pages.signIn.
    authorized: ({ auth, request: { nextUrl } }) => {
      const isLoggedIn = !!auth?.user;
      const isOnAdmin = nextUrl.pathname.startsWith("/admin");
      if (isOnAdmin) return isLoggedIn;
      return true;
    },
    signIn: async ({ user }) => {
      const email = user.email?.toLowerCase().trim();
      if (!email || !adminEmail) return false;
      return email === adminEmail;
    },
    jwt: async ({ token, user }) => {
      if (user) token.id = user.id as string;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
