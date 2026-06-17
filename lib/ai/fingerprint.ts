/**
 * Build a compact "voice + expertise fingerprint" from the user's onboarding
 * inputs (skills, niche, bio, and their own pasted sample posts).
 *
 * This is the COMPLIANT substitute for reading LinkedIn history via API — we
 * only ever use data the user provided. See docs/09 §9.2.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { expertiseProfiles, userSkills } from "@/lib/db/schema";

export interface ProfileLike {
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  niche?: string | null;
  targetAudience?: string | null;
  contentPillars?: string[] | null;
  samplePosts?: string[] | null;
  skills?: string[];
}

export function composeFingerprint(p: ProfileLike): string {
  const lines = [
    p.headline && `Headline: ${p.headline}`,
    p.industry && `Industry: ${p.industry}`,
    p.niche && `Niche: ${p.niche}`,
    p.targetAudience && `Audience: ${p.targetAudience}`,
    p.skills?.length && `Skills: ${p.skills.join(", ")}`,
    p.contentPillars?.length && `Content pillars: ${p.contentPillars.join(", ")}`,
    p.bio && `Bio: ${p.bio}`,
    p.samplePosts?.length &&
      `Voice samples (the author's own past posts):\n- ${p.samplePosts
        .slice(0, 5)
        .join("\n- ")}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Load the profile + skills from the DB and compose the fingerprint. */
export async function loadFingerprint(userId: string): Promise<{
  fingerprint: string;
  niche: string | null;
  tone: string | null;
}> {
  const [profile] = await db
    .select()
    .from(expertiseProfiles)
    .where(eq(expertiseProfiles.userId, userId))
    .limit(1);

  const skills = await db
    .select({ name: userSkills.name })
    .from(userSkills)
    .where(eq(userSkills.userId, userId));

  const fingerprint = composeFingerprint({
    headline: profile?.headline,
    bio: profile?.bio,
    industry: profile?.industry,
    niche: profile?.niche,
    targetAudience: profile?.targetAudience,
    contentPillars: profile?.contentPillars ?? [],
    samplePosts: profile?.samplePosts ?? [],
    skills: skills.map((s) => s.name),
  });

  const tone =
    profile?.tonePreferences && typeof profile.tonePreferences === "object"
      ? JSON.stringify(profile.tonePreferences)
      : null;

  return { fingerprint, niche: profile?.niche ?? null, tone };
}
