/**
 * Edge-safe Auth.js config — NO database imports.
 *
 * Used by middleware (edge runtime) for route protection and by lib/auth.ts
 * (Node runtime), which extends it with DB-backed callbacks. Keeping DB access
 * out of this file is what lets middleware run on the edge.
 */
import type { NextAuthConfig } from "next-auth";
import LinkedIn from "next-auth/providers/linkedin";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  providers: [
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      authorization: {
        // Sign-in scopes + posting scope in a single consent.
        params: { scope: "openid profile email w_member_social" },
      },
    }),
  ],
  callbacks: {
    /** Route protection. `/` and the auth endpoints are public. */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = pathname === "/" || pathname.startsWith("/api/auth");
      if (isPublic) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
