/**
 * One-shot generation for testing/verification.
 * Runs the real generation pipeline for the first user, today's date.
 *   npx tsx scripts/generate-once.ts
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { generateDailyPost } from "@/lib/content/generate";

async function main() {
  // Target the main (earliest) account for testing.
  const [u] = await db.select().from(users).orderBy(users.createdAt).limit(1);
  if (!u) {
    console.error("No user found — sign in first.");
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const topicArg = process.argv.slice(2).join(" ").trim();
  console.log(
    `Generating for user ${u.email} (${today})` +
      (topicArg ? ` — topic: "${topicArg}"` : "") +
      "…",
  );
  const t0 = Date.now();
  const summary = await generateDailyPost(
    u.id,
    today,
    topicArg ? { topicOverride: { title: topicArg } } : { alwaysNew: true },
  );
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("generation failed:", err);
  process.exit(1);
});
