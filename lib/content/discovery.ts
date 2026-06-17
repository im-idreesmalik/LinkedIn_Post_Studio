/**
 * Content discovery — recommend post topics from the user's expertise + their
 * own pasted sample posts (compliant; no LinkedIn scraping). See docs/03 §A2.
 */
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { topicSuggestions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { chatJSON } from "@/lib/ai/llm";

const topicsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string(),
        angle: z.string().default(""),
        format: z.string().default("story"),
        rationale: z.string().default(""),
      }),
    )
    .default([]),
});

const SYSTEM = `You suggest TIMELY LinkedIn post topics tailored to a professional's expertise.
Prefer CURRENT, recent, and trending developments in their field — recent releases, news,
announcements, or active discussions from roughly the last few weeks. Be specific and current,
not generic or evergreen. It's fine to reference a recent event/version/trend by name.
Vary the format across: story, listicle, how-to, hot-take, case-study.
Respond with ONLY JSON: {"topics":[{"title","angle","format","rationale"}]}.`;

/** Ask the configured model for a batch of topics and persist them. */
export async function generateTopics(
  userId: string,
  fingerprint: string,
  count = 5,
  model: string = env.OLLAMA_CAPTION_MODEL,
): Promise<void> {
  const raw = await chatJSON({
    model,
    system: SYSTEM,
    user: `Suggest ${count} timely topics (use current/trending developments) for this author:\n${fingerprint}`,
    temperature: 0.9,
    grounded: true, // use live Google Search when on Gemini
  });
  const parsed = topicsSchema.parse(JSON.parse(raw));

  if (parsed.topics.length) {
    await db.insert(topicSuggestions).values(
      parsed.topics.map((t) => ({
        userId,
        title: t.title,
        angle: t.angle,
        format: t.format,
        rationale: t.rationale,
        source: "expertise" as const,
        status: "suggested" as const,
      })),
    );
  }
  log.info("topics.generated", { userId, count: parsed.topics.length });
}

export interface SelectedTopic {
  id: string;
  title: string;
  angle: string | null;
  format: string | null;
}

/** Pick the next unused topic, generating a fresh batch if the queue is empty. */
export async function selectTopicForToday(
  userId: string,
  fingerprint: string,
  model: string = env.OLLAMA_CAPTION_MODEL,
): Promise<SelectedTopic> {
  let [topic] = await db
    .select()
    .from(topicSuggestions)
    .where(
      and(eq(topicSuggestions.userId, userId), eq(topicSuggestions.status, "suggested")),
    )
    .orderBy(desc(topicSuggestions.createdAt))
    .limit(1);

  if (!topic) {
    await generateTopics(userId, fingerprint, 5, model);
    [topic] = await db
      .select()
      .from(topicSuggestions)
      .where(
        and(
          eq(topicSuggestions.userId, userId),
          eq(topicSuggestions.status, "suggested"),
        ),
      )
      .orderBy(desc(topicSuggestions.createdAt))
      .limit(1);
  }

  if (!topic) {
    // Last-resort evergreen fallback so the daily job never hard-fails.
    [topic] = await db
      .insert(topicSuggestions)
      .values({
        userId,
        title: "A lesson I learned in my field this week",
        angle: "personal reflection with a practical takeaway",
        format: "story",
        source: "expertise",
        status: "suggested",
      })
      .returning();
  }

  await db
    .update(topicSuggestions)
    .set({ status: "selected" })
    .where(eq(topicSuggestions.id, topic.id));

  return { id: topic.id, title: topic.title, angle: topic.angle, format: topic.format };
}
