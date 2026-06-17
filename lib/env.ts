/**
 * Validated environment configuration.
 * Throws on boot if a required variable is missing/malformed.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(16),
  // AUTH_URL is read directly by Auth.js; not required here.

  // base64-encoded 32-byte key
  TOKEN_ENC_KEY: z.string().min(1),

  LINKEDIN_CLIENT_ID: z.string().default(""),
  LINKEDIN_CLIENT_SECRET: z.string().default(""),
  LINKEDIN_API_VERSION: z.string().default("202506"),

  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_CAPTION_MODEL: z.string().default("qwen2.5:14b"),

  // Gemini 2.5 Flash — free-tier API key for captions/topics (text only).
  GEMINI_API_KEY: z.string().default(""),

  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_BUCKET: z.string().default("post-images"),
  S3_PUBLIC_URL: z.string().url().default("http://localhost:9000/post-images"),

  SMTP_URL: z.string().default(""),
  EMAIL_FROM: z.string().default("LinkedIn Post Studio <daily@example.com>"),

  DEFAULT_GENERATION_HOUR: z.coerce.number().int().min(0).max(23).default(7),
});

// In the browser, env vars aren't available — only import this on the server.
export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
