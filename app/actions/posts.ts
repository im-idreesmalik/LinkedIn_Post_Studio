"use server";

/**
 * Server Actions for the review workflow.
 *
 * The publish path (`approveAndPublish`) is the ONLY way a post reaches
 * LinkedIn. It is reachable solely from an explicit user action in the
 * dashboard, on an owned post in an approvable state. No background job, cron,
 * or webhook calls it. See docs/03 §C.4 and docs/04 §4.4.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  posts,
  postImages,
  postRevisions,
  publishLogs,
  auditLogs,
} from "@/lib/db/schema";
import { hasLinkedInConnection } from "@/lib/linkedin/store";
import { uploadImage, publishPost, LinkedInError } from "@/lib/linkedin/client";
import {
  createImageAsset,
  buildImagePrompt,
  storeUploadedImage,
} from "@/lib/ai/image";
import { generateDailyPost } from "@/lib/content/generate";
import { getObject, urlToKey, deleteObject } from "@/lib/storage";
import { loadFingerprint } from "@/lib/ai/fingerprint";
import { fetchSources } from "@/lib/content/fetch-url";
import { getBoss, Queues } from "@/lib/queue";
import { log } from "@/lib/logger";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

async function getOwnedPost(userId: string, postId: string) {
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .limit(1);
  return post ?? null;
}

async function nextRevisionNo(postId: string): Promise<number> {
  const [last] = await db
    .select({ v: postRevisions.versionNo })
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.versionNo))
    .limit(1);
  return (last?.v ?? 0) + 1;
}

/** Save an edited caption (and parts). Records a revision for audit/undo. */
export async function saveCaptionEdit(input: {
  postId: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
}): Promise<ActionResult> {
  const userId = await requireUserId();
  const post = await getOwnedPost(userId, input.postId);
  if (!post) return { ok: false, message: "Post not found." };
  if (["published", "approved"].includes(post.status)) {
    return { ok: false, message: "This post can no longer be edited." };
  }

  const tags = input.hashtags
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`))
    .filter(Boolean);
  const assembled = [input.hook, "", input.body, "", input.cta, "", tags.join(" ")]
    .join("\n")
    .trim()
    .slice(0, 3000);

  await db
    .update(posts)
    .set({
      hook: input.hook,
      body: input.body,
      cta: input.cta,
      hashtags: tags,
      editedCaption: assembled,
      captionFinal: assembled,
      charCount: assembled.length,
      status: post.status === "in_review" ? "edited" : post.status,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, input.postId));

  await db.insert(postRevisions).values({
    postId: input.postId,
    versionNo: await nextRevisionNo(input.postId),
    captionSnapshot: assembled,
    editedBy: userId,
    note: "user edit",
  });

  revalidatePath(`/posts/${input.postId}`);
  revalidatePath("/");
  return { ok: true };
}

/** Regenerate the post image with a fresh seed/prompt. */
export async function regenerateImage(postId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const post = await getOwnedPost(userId, postId);
  if (!post) return { ok: false, message: "Post not found." };

  try {
    const { niche } = await loadFingerprint(userId);
    const prompt = buildImagePrompt(post.hook ?? post.body ?? "professional topic", niche);
    const asset = await createImageAsset({
      prompt,
      keyPrefix: `${userId}/${postId}/${Date.now()}`,
      provider: "pollinations",
    });
    await db
      .update(postImages)
      .set({ isSelected: false })
      .where(eq(postImages.postId, postId));
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
        altText: post.hook ?? "",
        status: "ready",
        isSelected: true,
      })
      .returning({ id: postImages.id });
    await db.update(posts).set({ selectedImageId: img.id }).where(eq(posts.id, postId));

    revalidatePath(`/posts/${postId}`);
    return { ok: true };
  } catch (err) {
    log.warn("regenerate_image.failed", { postId, error: String(err) });
    return { ok: false, message: "Image generation failed. Try again." };
  }
}

/** Upload a user-supplied image and make it the post's selected image. */
export async function uploadPostImage(
  postId: string,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const post = await getOwnedPost(userId, postId);
  if (!post) return { ok: false, message: "Post not found." };
  if (post.status === "published") {
    return { ok: false, message: "This post is already published." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file selected." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, message: "Please choose an image file." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: "Image too large (max 10 MB)." };
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const asset = await storeUploadedImage({
      bytes,
      keyPrefix: `${userId}/${postId}/${Date.now()}`,
    });
    // Deselect any existing images, then add + select the upload.
    await db.update(postImages).set({ isSelected: false }).where(eq(postImages.postId, postId));
    const [img] = await db
      .insert(postImages)
      .values({
        postId,
        provider: "manual_upload",
        storageUrl: asset.storageUrl,
        thumbnailUrl: asset.thumbnailUrl,
        width: asset.width,
        height: asset.height,
        altText: post.hook ?? "",
        status: "ready",
        isSelected: true,
      })
      .returning({ id: postImages.id });
    await db.update(posts).set({ selectedImageId: img.id }).where(eq(posts.id, postId));

    revalidatePath(`/posts/${postId}`);
    return { ok: true, message: "Image uploaded." };
  } catch (err) {
    log.warn("upload_image.failed", { postId, error: String(err) });
    return { ok: false, message: "Upload failed. Try a different image." };
  }
}

/** Discard a draft — PERMANENTLY delete it (and its images). Not recoverable. */
export async function discardPost(postId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const post = await getOwnedPost(userId, postId);
  if (!post) return { ok: false, message: "Post not found." };

  // Remove stored images from object storage (DB child rows cascade on delete).
  const imgs = await db
    .select({ s: postImages.storageUrl, t: postImages.thumbnailUrl })
    .from(postImages)
    .where(eq(postImages.postId, postId));
  for (const im of imgs) {
    if (im.s) await deleteObject(urlToKey(im.s));
    if (im.t) await deleteObject(urlToKey(im.t));
  }

  await db.delete(posts).where(eq(posts.id, postId)); // cascades images/revisions/logs

  await db.insert(auditLogs).values({
    userId,
    action: "post.discarded",
    entityType: "post",
    entityId: postId,
  });
  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true, message: "Draft deleted." };
}

/**
 * THE REVIEW GATE. Publishes an owned, approved-by-the-user post to LinkedIn.
 */
export async function approveAndPublish(postId: string): Promise<ActionResult> {
  const userId = await requireUserId();

  if (!(await hasLinkedInConnection(userId))) {
    return { ok: false, message: "Connect your LinkedIn account first." };
  }

  // Atomically claim the post: only transition from a reviewable state. A
  // concurrent double-click finds 0 rows and aborts -> no double-post.
  const [claimed] = await db
    .update(posts)
    .set({ status: "approved", approvedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        inArray(posts.status, ["in_review", "edited", "publish_failed"]),
      ),
    )
    .returning();

  if (!claimed) {
    return { ok: false, message: "Post is not in a publishable state." };
  }

  const commentary = claimed.editedCaption ?? claimed.captionFinal ?? "";
  if (!commentary.trim()) {
    await db.update(posts).set({ status: "edited" }).where(eq(posts.id, postId));
    return { ok: false, message: "The caption is empty." };
  }

  // Upload the selected image to LinkedIn (if any).
  let imageUrn: string | null = null;
  let altText: string | null = null;
  if (claimed.selectedImageId) {
    const [img] = await db
      .select()
      .from(postImages)
      .where(eq(postImages.id, claimed.selectedImageId))
      .limit(1);
    if (img?.storageUrl && img.status === "ready") {
      try {
        const bytes = await getObject(urlToKey(img.storageUrl));
        imageUrn = await uploadImage(userId, bytes);
        altText = img.altText ?? null;
        await db
          .update(postImages)
          .set({ linkedinAssetUrn: imageUrn, status: "uploaded_to_linkedin" })
          .where(eq(postImages.id, img.id));
      } catch (err) {
        log.warn("publish.image_upload_failed", { postId, error: String(err) });
        // Fall through: publish text-only rather than failing the whole post.
      }
    }
  }

  // Publish via the official Posts API.
  try {
    const result = await publishPost({ userId, commentary, imageUrn, imageAltText: altText });

    await db.insert(publishLogs).values({
      postId,
      userId,
      linkedinPostUrn: result.postUrn ?? null,
      requestPayload: { hasImage: !!imageUrn, chars: commentary.length },
      responseStatus: result.status,
      responseBody: (result.body as object) ?? null,
      succeeded: result.ok,
      idempotencyKey: `pub:${postId}`,
      errorMessage: result.ok ? null : "LinkedIn returned a non-2xx status",
    });

    if (result.ok) {
      await db
        .update(posts)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(posts.id, postId));
      await db.insert(auditLogs).values({
        userId,
        action: "post.published",
        entityType: "post",
        entityId: postId,
        metadata: { postUrn: result.postUrn ?? null },
      });
      revalidatePath("/");
      revalidatePath(`/posts/${postId}`);
      return { ok: true, message: "Published to LinkedIn." };
    }

    await db.update(posts).set({ status: "publish_failed" }).where(eq(posts.id, postId));
    return { ok: false, message: `LinkedIn rejected the post (HTTP ${result.status}).` };
  } catch (err) {
    await db.update(posts).set({ status: "publish_failed" }).where(eq(posts.id, postId));
    const msg =
      err instanceof LinkedInError && err.status === 429
        ? "LinkedIn is rate-limiting right now — try again shortly."
        : err instanceof LinkedInError && err.status === 401
          ? "Your LinkedIn connection expired — please reconnect."
          : "Publishing failed. Your draft is safe; you can retry.";
    await db.insert(publishLogs).values({
      postId,
      userId,
      succeeded: false,
      errorMessage: String(err),
      idempotencyKey: `pub:${postId}`,
    });
    log.error("publish.failed", { postId, error: String(err) });
    return { ok: false, message: msg };
  }
}

/** "Generate now" — enqueue today's draft instead of waiting for the schedule. */
export async function generateNow(): Promise<ActionResult> {
  const userId = await requireUserId();
  const today = new Date().toISOString().slice(0, 10);
  const boss = await getBoss();
  await boss.send(
    Queues.GenerateUser,
    { userId, scheduledDate: today, manual: true },
    // Unique key per click so each generation adds a NEW draft (kept until discarded).
    { singletonKey: `gen:${userId}:${today}:${Date.now()}` },
  );
  return { ok: true, message: "Generating a new draft — it'll appear shortly." };
}

/**
 * Generate a draft from a topic the user typed. Runs inline (the user is
 * waiting) and replaces today's draft. Still review-gated — nothing publishes.
 */
export async function generateFromTopic(
  topicText: string,
  tone?: string,
  sourceUrlsText?: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const title = topicText.trim();
  const urls = (sourceUrlsText ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  if (!title && urls.length === 0) {
    return { ok: false, message: "Enter a topic or at least one article URL." };
  }
  if (title.length > 300) return { ok: false, message: "Topic is too long." };

  // If URLs are provided, read them and base the post on their content.
  let sourceMaterial: string | undefined;
  if (urls.length) {
    sourceMaterial = await fetchSources(urls);
    if (!sourceMaterial) {
      return {
        ok: false,
        message: "Couldn't read those URLs. Check the links, or generate without them.",
      };
    }
  }

  const effectiveTitle =
    title || "Key takeaways and my perspective on a recent article I read";

  const today = new Date().toISOString().slice(0, 10);
  try {
    const summary = await generateDailyPost(userId, today, {
      topicOverride: { title: effectiveTitle },
      toneOverride: tone?.trim() || undefined,
      sourceMaterial,
    });
    revalidatePath("/");
    revalidatePath(`/posts/${summary.postId}`);
    return {
      ok: true,
      message: sourceMaterial
        ? "Draft created from the article(s)."
        : "Draft created from your topic.",
    };
  } catch (err) {
    log.error("generate_from_topic.failed", { userId, error: String(err) });
    return {
      ok: false,
      message:
        "Generation failed. Make sure Ollama is running, then try again.",
    };
  }
}
