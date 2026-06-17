/**
 * Shared Drizzle client (postgres-js driver).
 * Used by both the Next.js app and the worker process.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse the connection across hot-reloads in dev to avoid exhausting Postgres.
const globalForDb = globalThis as unknown as {
  __pg__?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__pg__ ??
  postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false, // safer with pg-boss / pooled setups
  });

if (env.NODE_ENV !== "production") globalForDb.__pg__ = client;

export const db = drizzle(client, { schema });
export { schema };
export * from "./schema";
