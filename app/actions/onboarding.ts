"use server";

/**
 * Onboarding & settings actions — capture the expertise inputs that drive
 * content discovery (the compliant substitute for reading LinkedIn history).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  expertiseProfiles,
  userSkills,
  userSettings,
  users,
  linkedinAccounts,
} from "@/lib/db/schema";
import { composeFingerprint } from "@/lib/ai/fingerprint";
import { fetchUserInfo } from "@/lib/linkedin/client";
import { sendDailyDigest } from "@/lib/email/service";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import type { ActionResult } from "./posts";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const profileSchema = z.object({
  headline: z.string().max(220).optional().default(""),
  bio: z.string().max(4000).optional().default(""),
  industry: z.string().max(120).optional().default(""),
  niche: z.string().max(160).optional().default(""),
  targetAudience: z.string().max(220).optional().default(""),
  contentPillars: z.array(z.string()).default([]),
  samplePosts: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  timezone: z.string().default("UTC"),
  generationHour: z.coerce.number().int().min(0).max(23).default(7),
  notificationEmail: z.string().optional().default(""),
});

export async function saveOnboarding(
  raw: z.input<typeof profileSchema>,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const input = profileSchema.parse(raw);

  const fingerprint = composeFingerprint({
    headline: input.headline,
    bio: input.bio,
    industry: input.industry,
    niche: input.niche,
    targetAudience: input.targetAudience,
    contentPillars: input.contentPillars,
    samplePosts: input.samplePosts,
    skills: input.skills,
  });

  await db
    .insert(expertiseProfiles)
    .values({
      userId,
      headline: input.headline,
      bio: input.bio,
      industry: input.industry,
      niche: input.niche,
      targetAudience: input.targetAudience,
      contentPillars: input.contentPillars,
      samplePosts: input.samplePosts,
      fingerprint,
    })
    .onConflictDoUpdate({
      target: expertiseProfiles.userId,
      set: {
        headline: input.headline,
        bio: input.bio,
        industry: input.industry,
        niche: input.niche,
        targetAudience: input.targetAudience,
        contentPillars: input.contentPillars,
        samplePosts: input.samplePosts,
        fingerprint,
        updatedAt: new Date(),
      },
    });

  // Replace skills.
  await db.delete(userSkills).where(eq(userSkills.userId, userId));
  if (input.skills.length) {
    await db.insert(userSkills).values(
      input.skills
        .filter(Boolean)
        .map((name) => ({ userId, name })),
    );
  }

  // Settings (timezone + daily prep hour).
  const hh = String(input.generationHour).padStart(2, "0");
  const notifEmail = input.notificationEmail?.trim() || null;
  await db
    .insert(userSettings)
    .values({
      userId,
      timezone: input.timezone,
      generationTimeLocal: `${hh}:00`,
      notificationEmail: notifEmail,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        timezone: input.timezone,
        generationTimeLocal: `${hh}:00`,
        notificationEmail: notifEmail,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export interface LinkedInSyncResult extends ActionResult {
  info?: { name: string | null; email: string | null; picture: string | null };
}

/**
 * Pull the member's LinkedIn profile (OpenID userinfo) and update the account.
 * Only name, email, locale, and photo are available via the API — headline,
 * bio, industry, and skills are NOT exposed and stay manual.
 */
export async function syncLinkedInProfile(): Promise<LinkedInSyncResult> {
  const userId = await requireUserId();
  try {
    const info = await fetchUserInfo(userId);
    const name = info.name ?? null;
    const picture = info.picture ?? null;
    const email = info.email ?? null;

    await db
      .update(users)
      .set({ name, avatarUrl: picture, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await db
      .update(linkedinAccounts)
      .set({ displayName: name })
      .where(eq(linkedinAccounts.userId, userId));

    // Default the notification email to the LinkedIn email if not already set.
    if (email) {
      const [s] = await db
        .select({ ne: userSettings.notificationEmail })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
      if (!s?.ne) {
        await db
          .update(userSettings)
          .set({ notificationEmail: email, updatedAt: new Date() })
          .where(eq(userSettings.userId, userId));
      }
    }

    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true, message: "Synced from LinkedIn.", info: { name, email, picture } };
  } catch (err) {
    log.error("linkedin.sync.failed", { userId, error: String(err) });
    return {
      ok: false,
      message: "Couldn't fetch from LinkedIn — your connection may have expired. Reconnect and retry.",
    };
  }
}

/** Send a test email to the configured notification address (verifies SMTP). */
export async function sendTestEmail(): Promise<ActionResult> {
  const userId = await requireUserId();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [s] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const to = s?.notificationEmail ?? u?.email ?? null;
  if (!to) return { ok: false, message: "No notification email set." };
  try {
    await sendDailyDigest(to, {
      name: u?.name ?? null,
      hook: "✅ Test email from LinkedIn Post Studio",
      snippet: "If you can read this, email delivery is working. Your daily post notifications will arrive here.",
      imageThumbUrl: null,
      reviewUrl: env.APP_URL,
    });
    return { ok: true, message: `Test email sent to ${to}.` };
  } catch (err) {
    log.error("test_email.failed", { error: String(err) });
    return {
      ok: false,
      message:
        "Send failed — set SMTP_URL in .env (e.g. a Gmail app password). " +
        String(err).slice(0, 140),
    };
  }
}

export async function setDailyGeneration(enabled: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  await db
    .update(userSettings)
    .set({ dailyGenerationEnabled: enabled, updatedAt: new Date() })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/settings");
  return { ok: true };
}
