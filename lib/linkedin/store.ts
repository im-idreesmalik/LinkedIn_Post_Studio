/**
 * Persist a LinkedIn OAuth connection (encrypted) and the signing-in user.
 * Called from the Auth.js sign-in flow.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  userSettings,
  expertiseProfiles,
  linkedinAccounts,
} from "@/lib/db/schema";
import { encryptToken } from "@/lib/crypto/tokens";
import { log } from "@/lib/logger";

export interface IncomingConnection {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  sub: string; // OIDC subject -> author URN
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds: number;
  refreshExpiresInSeconds?: number | null;
  scopes: string[];
}

/** Upsert the user + their encrypted LinkedIn tokens. Returns the user id. */
export async function storeConnection(c: IncomingConnection): Promise<string> {
  const memberUrn = `urn:li:person:${c.sub}`;
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + c.expiresInSeconds * 1000);
  const refreshExpiresAt = c.refreshExpiresInSeconds
    ? new Date(now.getTime() + c.refreshExpiresInSeconds * 1000)
    : null;

  // 1) Upsert user by email.
  const [user] = await db
    .insert(users)
    .values({
      email: c.email,
      name: c.name ?? null,
      avatarUrl: c.avatarUrl ?? null,
      authProvider: "linkedin",
      authSubject: c.sub,
      lastLoginAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: c.name ?? null, avatarUrl: c.avatarUrl ?? null, lastLoginAt: now },
    })
    .returning({ id: users.id });

  const userId = user.id;

  // 2) Ensure default settings + an (empty) expertise profile exist.
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  await db.insert(expertiseProfiles).values({ userId }).onConflictDoNothing();

  // 3) Encrypt + upsert the LinkedIn tokens.
  const access = encryptToken(c.accessToken);
  const refresh = c.refreshToken ? encryptToken(c.refreshToken) : null;

  await db
    .insert(linkedinAccounts)
    .values({
      userId,
      linkedinMemberUrn: memberUrn,
      linkedinSub: c.sub,
      displayName: c.name ?? null,
      accessTokenCiphertext: access.ciphertext,
      accessTokenNonce: access.nonce,
      refreshTokenCiphertext: refresh?.ciphertext ?? null,
      refreshTokenNonce: refresh?.nonce ?? null,
      scopes: c.scopes,
      accessExpiresAt,
      refreshExpiresAt,
      status: "connected",
      lastRefreshedAt: now,
    })
    .onConflictDoUpdate({
      target: [linkedinAccounts.userId, linkedinAccounts.linkedinMemberUrn],
      set: {
        accessTokenCiphertext: access.ciphertext,
        accessTokenNonce: access.nonce,
        refreshTokenCiphertext: refresh?.ciphertext ?? null,
        refreshTokenNonce: refresh?.nonce ?? null,
        scopes: c.scopes,
        accessExpiresAt,
        refreshExpiresAt,
        status: "connected",
        lastRefreshedAt: now,
      },
    });

  log.info("linkedin.connected", { userId, scopes: c.scopes });
  return userId;
}

/** True if the user has at least one connected LinkedIn account. */
export async function hasLinkedInConnection(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: linkedinAccounts.id })
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.userId, userId))
    .limit(1);
  return rows.length > 0;
}
