import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // We define our own pg ENUM types in schema.ts; keep verbose logs during dev.
  verbose: true,
  strict: true,
});
