/**
 * Daily generation jobs.
 *
 * - hourly tick: fan out one `generate-user` job per active user whose local
 *   prep-hour matches now and who has no post for today (per-timezone).
 * - generate-user: produce the draft, then enqueue the digest email.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userSettings, posts } from "@/lib/db/schema";
import { generateDailyPost } from "@/lib/content/generate";
import { getBoss, Queues, type GenerateUserJob } from "@/lib/queue";
import { log } from "@/lib/logger";

/** Local {hour, date} for an IANA timezone, computed without extra deps. */
function localParts(timezone: string): { hour: number; date: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export async function runHourlyTick(): Promise<void> {
  const boss = await getBoss();
  const rows = await db
    .select({
      userId: users.id,
      timezone: userSettings.timezone,
      genTime: userSettings.generationTimeLocal,
      enabled: userSettings.dailyGenerationEnabled,
      status: users.status,
    })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id));

  let enqueued = 0;
  for (const r of rows) {
    if (r.status !== "active" || !r.enabled) continue;
    const { hour, date } = localParts(r.timezone);
    const genHour = Number(String(r.genTime).slice(0, 2));
    if (hour !== genHour) continue;

    // Skip if a post already exists for today.
    const [existing] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.userId, r.userId), eq(posts.scheduledDate, date)))
      .limit(1);
    if (existing) continue;

    await boss.send(
      Queues.GenerateUser,
      { userId: r.userId, scheduledDate: date } satisfies GenerateUserJob,
      { singletonKey: `gen:${r.userId}:${date}` }, // idempotent
    );
    enqueued++;
  }
  log.info("hourly_tick.fanout", { candidates: rows.length, enqueued });
}

export async function runGenerateUser(job: GenerateUserJob): Promise<void> {
  const boss = await getBoss();
  const summary = await generateDailyPost(job.userId, job.scheduledDate, {
    alwaysNew: !!job.manual,
  });
  await boss.send(Queues.SendDigest, { userId: job.userId, postId: summary.postId });
}
