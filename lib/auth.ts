/**
 * Full Auth.js instance (Node runtime). Extends the edge-safe authConfig with
 * DB-backed callbacks: on first sign-in we upsert the user and store the
 * LinkedIn access/refresh tokens ENCRYPTED (see lib/linkedin/store.ts).
 *
 * A single LinkedIn OAuth grant covers both sign-in (OIDC) and posting
 * (`w_member_social`).
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { storeConnection } from "@/lib/linkedin/store";
import { log } from "@/lib/logger";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const acct = account as Record<string, unknown>;
        try {
          const userId = await storeConnection({
            email: (profile.email as string) ?? (token.email as string),
            name: (profile.name as string) ?? null,
            avatarUrl: (profile.picture as string) ?? null,
            sub: profile.sub as string,
            accessToken: acct.access_token as string,
            refreshToken: (acct.refresh_token as string) ?? null,
            expiresInSeconds: Number(acct.expires_in ?? 60 * 24 * 3600),
            refreshExpiresInSeconds: acct.refresh_token_expires_in
              ? Number(acct.refresh_token_expires_in)
              : null,
            scopes: String(acct.scope ?? "")
              .split(/[ ,]+/)
              .filter(Boolean),
          });
          token.uid = userId;
        } catch (err) {
          log.error("auth.storeConnection.failed", { error: String(err) });
          throw err;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
