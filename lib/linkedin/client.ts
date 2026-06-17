/**
 * LinkedIn API client — the ONLY component that writes to LinkedIn.
 *
 * Uses the member's own `w_member_social` grant. Implements:
 *   - getAccessToken (with proactive refresh)
 *   - uploadImage   (Images API: initialize -> PUT -> asset URN)
 *   - publishPost   (Posts API)
 *
 * NOTE: LinkedIn versions its API monthly and changes endpoints/limits. Items
 * marked [VERIFY] should be confirmed against current LinkedIn docs.
 * See docs/06-integrations.md §6.1.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { linkedinAccounts } from "@/lib/db/schema";
import { encryptToken, decryptToken } from "@/lib/crypto/tokens";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

const API_BASE = "https://api.linkedin.com/rest";
const OAUTH_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export class LinkedInError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export interface ActiveToken {
  accountId: string;
  memberUrn: string;
  accessToken: string;
}

function defaultHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": env.LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/** Load the connection, refreshing the token if it is near expiry. */
export async function getAccessToken(userId: string): Promise<ActiveToken> {
  const [acct] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.userId, userId))
    .limit(1);

  if (!acct) throw new LinkedInError("LinkedIn not connected", 401);
  if (acct.status === "revoked") throw new LinkedInError("LinkedIn access revoked", 401);

  const soon = Date.now() + 5 * 60 * 1000; // refresh if expiring within 5 min
  if (acct.accessExpiresAt.getTime() > soon) {
    return {
      accountId: acct.id,
      memberUrn: acct.linkedinMemberUrn,
      accessToken: decryptToken({
        ciphertext: acct.accessTokenCiphertext,
        nonce: acct.accessTokenNonce,
      }),
    };
  }

  // Token expired/expiring — try refresh if we have a refresh token.
  if (acct.refreshTokenCiphertext && acct.refreshTokenNonce) {
    const refreshed = await refreshToken(userId);
    return refreshed;
  }

  // No refresh token: mark expired so the UI prompts a reconnect.
  await db
    .update(linkedinAccounts)
    .set({ status: "expired" })
    .where(eq(linkedinAccounts.id, acct.id));
  throw new LinkedInError("LinkedIn token expired — reconnect required", 401);
}

export async function refreshToken(userId: string): Promise<ActiveToken> {
  const [acct] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.userId, userId))
    .limit(1);
  if (!acct?.refreshTokenCiphertext || !acct.refreshTokenNonce) {
    throw new LinkedInError("No refresh token available", 401);
  }

  const refresh = decryptToken({
    ciphertext: acct.refreshTokenCiphertext,
    nonce: acct.refreshTokenNonce,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    await db
      .update(linkedinAccounts)
      .set({ status: "expired" })
      .where(eq(linkedinAccounts.id, acct.id));
    throw new LinkedInError("Token refresh failed", res.status, await res.text());
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };

  const now = Date.now();
  const access = encryptToken(data.access_token);
  const newRefresh = data.refresh_token ? encryptToken(data.refresh_token) : null;

  await db
    .update(linkedinAccounts)
    .set({
      accessTokenCiphertext: access.ciphertext,
      accessTokenNonce: access.nonce,
      accessExpiresAt: new Date(now + data.expires_in * 1000),
      ...(newRefresh
        ? {
            refreshTokenCiphertext: newRefresh.ciphertext,
            refreshTokenNonce: newRefresh.nonce,
            refreshExpiresAt: data.refresh_token_expires_in
              ? new Date(now + data.refresh_token_expires_in * 1000)
              : acct.refreshExpiresAt,
          }
        : {}),
      status: "connected",
      lastRefreshedAt: new Date(now),
    })
    .where(eq(linkedinAccounts.id, acct.id));

  log.info("linkedin.token.refreshed", { userId });
  return {
    accountId: acct.id,
    memberUrn: acct.linkedinMemberUrn,
    accessToken: data.access_token,
  };
}

export interface LinkedInUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string | { country?: string; language?: string };
}

/**
 * Fetch the member's profile via the OpenID Connect userinfo endpoint.
 * NOTE: our scopes (openid/profile/email) only expose name, email, picture,
 * and locale. LinkedIn does NOT expose headline/bio/skills/experience to
 * self-serve apps — those remain manual entry. See docs/06 §6.1.7.
 */
export async function fetchUserInfo(userId: string): Promise<LinkedInUserInfo> {
  const { accessToken } = await getAccessToken(userId);
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new LinkedInError("userinfo failed", res.status, await res.text());
  }
  return (await res.json()) as LinkedInUserInfo;
}

/** Images API: initialize upload, PUT the bytes, return the image asset URN. */
export async function uploadImage(userId: string, bytes: Buffer): Promise<string> {
  const { accessToken, memberUrn } = await getAccessToken(userId);

  const init = await fetch(`${API_BASE}/images?action=initializeUpload`, {
    method: "POST",
    headers: { ...defaultHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner: memberUrn } }),
  });
  if (!init.ok) {
    throw new LinkedInError("Image initializeUpload failed", init.status, await init.text());
  }
  const initJson = (await init.json()) as {
    value: { uploadUrl: string; image: string };
  };

  const put = await fetch(initJson.value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) {
    throw new LinkedInError("Image binary upload failed", put.status, await put.text());
  }

  return initJson.value.image; // urn:li:image:...
}

export interface PublishResult {
  ok: boolean;
  postUrn?: string;
  status: number;
  body?: unknown;
}

/** Posts API: create a post on the member's own profile. */
export async function publishPost(opts: {
  userId: string;
  commentary: string;
  imageUrn?: string | null;
  imageAltText?: string | null;
}): Promise<PublishResult> {
  const { accessToken, memberUrn } = await getAccessToken(opts.userId);

  const payload: Record<string, unknown> = {
    author: memberUrn,
    commentary: opts.commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (opts.imageUrn) {
    payload.content = {
      media: { id: opts.imageUrn, altText: opts.imageAltText ?? "" },
    };
  }

  const res = await fetch(`${API_BASE}/posts`, {
    method: "POST",
    headers: { ...defaultHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Honor rate limiting.
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
    throw new LinkedInError("LinkedIn rate limited", 429, await res.text(), retryAfter);
  }

  // The created post URN is returned in a header. [VERIFY exact header name]
  const postUrn =
    res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? undefined;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => undefined);
  }

  return { ok: res.ok, postUrn, status: res.status, body };
}
