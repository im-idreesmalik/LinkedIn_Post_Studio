/**
 * Worker process — registers pg-boss handlers and schedules the cron ticks.
 * Run with: npm run worker  (dev)  /  npm run worker:start  (prod / Docker)
 *
 * IMPORTANT: this process performs generation, emailing, and token refresh.
 * It NEVER publishes to LinkedIn — publishing is gated behind the dashboard
 * Publish action only (see app/actions/posts.ts).
 */
import "dotenv/config";
import { getBoss, Queues, type GenerateUserJob, type SendDigestJob } from "@/lib/queue";
import {
  runHourlyTick,
  runGenerateUser,
} from "./jobs/daily-generation";
import { runSendDigest } from "./jobs/send-digest";
import { runRefreshTokens } from "./jobs/refresh-tokens";
import { log } from "@/lib/logger";

async function main() {
  const boss = await getBoss();

  // ---- workers ----
  await boss.work(Queues.HourlyTick, async () => {
    await runHourlyTick();
  });

  await boss.work(Queues.GenerateUser, async (jobs: any[]) => {
    for (const job of jobs) {
      try {
        log.info("job.generate_user.start", { jobId: job.id, data: job.data });
        await runGenerateUser(job.data as GenerateUserJob);
        log.info("job.generate_user.done", { jobId: job.id });
      } catch (err) {
        log.error("job.generate_user.failed", { jobId: job.id, error: String(err) });
        throw err;
      }
    }
  });

  await boss.work(Queues.SendDigest, async (jobs: any[]) => {
    for (const job of jobs) {
      try {
        await runSendDigest(job.data as SendDigestJob);
      } catch (err) {
        log.error("job.send_digest.failed", { jobId: job.id, error: String(err) });
        throw err;
      }
    }
  });

  await boss.work(Queues.RefreshTokens, async () => {
    await runRefreshTokens();
  });

  // ---- schedules (cron, in server time) ----
  await boss.schedule(Queues.HourlyTick, "0 * * * *"); // top of every hour
  await boss.schedule(Queues.RefreshTokens, "0 3 * * *"); // daily 03:00

  log.info("worker.started", {
    queues: Object.values(Queues),
  });

  const shutdown = async () => {
    log.info("worker.stopping");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("worker.fatal", { error: String(err) });
  process.exit(1);
});
