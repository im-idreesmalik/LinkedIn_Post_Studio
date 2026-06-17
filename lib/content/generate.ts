/**
 * Generation orchestrator — turns "who the user is" into a reviewable draft:
 * topic -> caption -> image -> stored post in status `in_review`.
 *
 * Idempotent per (userId, scheduledDate). NEVER publishes; the draft waits for
 * the human review gate. See docs/01 §1.4 and docs/04.
 */
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  posts,
  postImages,
  userSettings,
  topicSuggestions,
} from "@/lib/db/schema";
import { loadFingerprint } from "@/lib/ai/fingerprint";
import { selectTopicForToday } from "./discovery";
import { generateCaption } from "@/lib/ai/caption";
import {
  createImageAsset,
  buildImagePrompt,
  buildImagePromptFromConcept,
} from "@/lib/ai/image";
import { log } from "@/lib/logger";

export interface GeneratedSummary {
  postId: string;
  hook: string;
  snippet: string;
  thumbnailUrl: string | null;
}

export interface GenerateOptions {
  /** Use this user-provided topic instead of auto-discovery. Implies a new draft. */
  topicOverride?: { title: string; angle?: string; format?: string };
  /** Force a brand-new draft even if today already has one (manual generation). */
  alwaysNew?: boolean;
  /** Override the caption tone for this generation. */
  toneOverride?: string;
  /** Article text (from user URLs) to base the post on. */
  sourceMaterial?: string;
}

/**
 * Generate a draft for a user on a given local date.
 *
 * - Manual generation (topicOverride or alwaysNew) ALWAYS creates a new draft;
 *   existing drafts are kept until the user discards them.
 * - The scheduled daily run stays one-per-day: if an active draft already
 *   exists for the date, it returns that instead of adding another.
 */
export async function generateDailyPost(
  userId: string,
  scheduledDate: string, // 'YYYY-MM-DD'
  opts: GenerateOptions = {},
): Promise<GeneratedSummary> {
  const manual = opts.alwaysNew || !!opts.topicOverride;

  // 1) Scheduled-only idempotency: don't pile up auto-posts. (Manual always new.)
  if (!manual) {
    const [existing] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.userId, userId), eq(posts.scheduledDate, scheduledDate)))
      .orderBy(desc(posts.createdAt))
      .limit(1);
    if (existing && !["generation_failed", "archived"].includes(existing.status)) {
      return toSummary(existing.id, existing.hook, existing.body, null);
    }
  }

  // 2) Settings + voice fingerprint.
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const { fingerprint, niche, tone } = await loadFingerprint(userId);

  // 3) Always create a fresh draft row in `generating`. Old drafts are never
  //    deleted or overwritten — they remain until the user discards them.
  const postId = await insertGeneratingPost(userId, scheduledDate);

  let topic: Awaited<ReturnType<typeof selectTopicForToday>> | null = null;
  try {
    // 4) Topic — either the user's provided topic, or auto-discovery.
    if (opts.topicOverride) {
      const [row] = await db
        .insert(topicSuggestions)
        .values({
          userId,
          title: opts.topicOverride.title,
          angle: opts.topicOverride.angle ?? "",
          format: opts.topicOverride.format ?? "story",
          source: "manual",
          status: "selected",
        })
        .returning();
      topic = { id: row.id, title: row.title, angle: row.angle, format: row.format };
    } else {
      topic = await selectTopicForToday(
        userId,
        fingerprint,
        settings?.preferredCaptionModel ?? undefined,
      );
    }
    await db.update(posts).set({ topicId: topic.id }).where(eq(posts.id, postId));

    // 5) Caption.
    const caption = await generateCaption({
      fingerprint,
      topic: { title: topic.title, angle: topic.angle, format: topic.format },
      tone: opts.toneOverride ?? tone ?? settings?.defaultTone ?? undefined,
      model: settings?.preferredCaptionModel ?? undefined,
      sourceMaterial: opts.sourceMaterial,
      // With source material, base it on that. Otherwise, for manual posts,
      // search live for up-to-date facts.
      grounded: opts.sourceMaterial ? false : manual,
    });

    await db
      .update(posts)
      .set({
        hook: caption.hook,
        body: caption.body,
        cta: caption.cta,
        hashtags: caption.hashtags,
        captionFinal: caption.caption,
        format: caption.format,
        charCount: caption.caption.length,
        captionModel: settings?.preferredCaptionModel ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));

    // 6) Image (optional).
    let thumbnailUrl: string | null = null;
    if (settings?.imageGenerationEnabled ?? true) {
      try {
        // Prefer the post-specific concept from the caption model (keeps the
        // image related to the content); fall back to a topic-based prompt.
        const prompt = caption.imageConcept
          ? buildImagePromptFromConcept(caption.imageConcept)
          : buildImagePrompt(topic.title, niche);
        const asset = await createImageAsset({
          prompt,
          keyPrefix: `${userId}/${postId}/${Date.now()}`,
          provider: "pollinations",
        });
        const [img] = await db
          .insert(postImages)
          .values({
            postId,
            provider: asset.provider,
            prompt,
            storageUrl: asset.storageUrl,
            thumbnailUrl: asset.thumbnailUrl,
            width: asset.width,
            height: asset.height,
            aspectRatio: "1.91:1",
            altText: topic.title,
            status: "ready",
            isSelected: true,
          })
          .returning({ id: postImages.id });
        await db.update(posts).set({ selectedImageId: img.id }).where(eq(posts.id, postId));
        thumbnailUrl = asset.thumbnailUrl;
      } catch (imgErr) {
        // Image failure is non-fatal — the post is valid as text-only.
        log.warn("image.failed", { postId, error: String(imgErr) });
        await db
          .insert(postImages)
          .values({ postId, provider: "none", status: "failed" });
      }
    }

    // 7) Ready for review + mark topic used.
    await db.update(posts).set({ status: "in_review", updatedAt: new Date() }).where(eq(posts.id, postId));
    await db
      .update(topicSuggestions)
      .set({ status: "used" })
      .where(eq(topicSuggestions.id, topic.id));

    log.info("post.generated", { userId, postId, scheduledDate });
    return toSummary(postId, caption.hook, caption.body, thumbnailUrl);
  } catch (err) {
    await db
      .update(posts)
      .set({ status: "generation_failed", updatedAt: new Date() })
      .where(eq(posts.id, postId));
    log.error("post.generation_failed", { userId, postId, error: String(err) });
    throw err;
  }
}

async function insertGeneratingPost(
  userId: string,
  scheduledDate: string,
): Promise<string> {
  // Plain insert — multiple drafts per day are allowed and preserved.
  const [row] = await db
    .insert(posts)
    .values({ userId, scheduledDate, status: "generating" })
    .returning({ id: posts.id });
  return row.id;
}

function toSummary(
  postId: string,
  hook: string | null,
  body: string | null,
  thumbnailUrl: string | null,
): GeneratedSummary {
  const snippet = (body ?? "").slice(0, 160) + ((body?.length ?? 0) > 160 ? "…" : "");
  return { postId, hook: hook ?? "", snippet, thumbnailUrl };
}
