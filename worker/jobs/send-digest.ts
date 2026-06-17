/**
 * Send the daily "your post is ready" digest and record it in email_logs.
 * Email is a NOTIFICATION only — never a publish channel.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userSettings, posts, postImages, emailLogs } from "@/lib/db/schema";
import { sendDailyDigest } from "@/lib/email/service";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import type { SendDigestJob } from "@/lib/queue";

export async function runSendDigest(job: SendDigestJob): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, job.userId)).limit(1);
  if (!user) return;

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, job.userId))
    .limit(1);
  const to = settings?.notificationEmail ?? user.email;

  const [post] = await db.select().from(posts).where(eq(posts.id, job.postId)).limit(1);
  if (!post) return;

  let thumb: string | null = null;
  if (post.selectedImageId) {
    const [img] = await db
      .select({ url: postImages.thumbnailUrl })
      .from(postImages)
      .where(eq(postImages.id, post.selectedImageId))
      .limit(1);
    thumb = img?.url ?? null;
  }

  const reviewUrl = `${env.APP_URL}/posts/${post.id}`;
  const snippet =
    (post.body ?? "").slice(0, 160) + ((post.body?.length ?? 0) > 160 ? "…" : "");

  try {
    const result = await sendDailyDigest(to, {
      name: user.name,
      hook: post.hook ?? "Your post is ready",
      snippet,
      imageThumbUrl: thumb,
      reviewUrl,
    });
    await db.insert(emailLogs).values({
      userId: job.userId,
      postId: post.id,
      type: "daily_digest",
      providerMessageId: result.messageId,
      toAddress: to,
      subject: "✅ Today's LinkedIn post is ready to review",
      status: result.accepted ? "sent" : "failed",
      sentAt: new Date(),
    });
  } catch (err) {
    log.error("digest.failed", { userId: job.userId, error: String(err) });
    await db.insert(emailLogs).values({
      userId: job.userId,
      postId: post.id,
      type: "daily_digest",
      toAddress: to,
      status: "failed",
      errorMessage: String(err),
    });
  }
}
