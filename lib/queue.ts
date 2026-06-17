/**
 * pg-boss job queue — durable, lives inside the existing Postgres (no Redis,
 * no SaaS, no cost). Shared by the worker (registers handlers) and the app
 * (enqueues "generate now"). See docs/05 §5.4.
 */
import PgBoss from "pg-boss";
import { env } from "@/lib/env";

export const Queues = {
  HourlyTick: "hourly-tick",
  GenerateUser: "generate-user",
  SendDigest: "send-digest",
  RefreshTokens: "refresh-tokens",
} as const;

let bossPromise: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss(env.DATABASE_URL);
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      // v10 requires queues to exist before send/work/schedule.
      for (const q of Object.values(Queues)) {
        await boss.createQueue(q);
      }
      return boss;
    })();
  }
  return bossPromise;
}

export interface GenerateUserJob {
  userId: string;
  scheduledDate: string; // YYYY-MM-DD (user-local)
  manual?: boolean; // true = user-clicked "Generate now" -> always a new draft
}

export interface SendDigestJob {
  userId: string;
  postId: string;
}
