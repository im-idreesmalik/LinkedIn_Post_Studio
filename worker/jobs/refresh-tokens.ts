/**
 * Proactively refresh LinkedIn tokens nearing expiry (where a refresh token is
 * available). Tokens without refresh capability are marked `expired` so the UI
 * prompts a reconnect. See docs/06 §6.1.3.
 */
import { lte, isNotNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { linkedinAccounts } from "@/lib/db/schema";
import { refreshToken } from "@/lib/linkedin/client";
import { log } from "@/lib/logger";

export async function runRefreshTokens(): Promise<void> {
  const cutoff = new Date(Date.now() + 2 * 24 * 3600 * 1000); // within 2 days

  const due = await db
    .select({ userId: linkedinAccounts.userId })
    .from(linkedinAccounts)
    .where(
      and(
        lte(linkedinAccounts.accessExpiresAt, cutoff),
        isNotNull(linkedinAccounts.refreshTokenCiphertext),
      ),
    );

  let ok = 0;
  for (const row of due) {
    try {
      await refreshToken(row.userId);
      ok++;
    } catch (err) {
      log.warn("token_refresh.failed", { userId: row.userId, error: String(err) });
    }
  }
  log.info("token_refresh.run", { due: due.length, refreshed: ok });
}
