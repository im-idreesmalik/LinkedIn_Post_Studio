/**
 * Minimal structured logger with token/secret redaction.
 * Never log access tokens, refresh tokens, or full OAuth payloads.
 */
type Level = "info" | "warn" | "error" | "debug";

const REDACT_KEYS = [
  "access_token",
  "refresh_token",
  "accessToken",
  "refreshToken",
  "authorization",
  "client_secret",
  "password",
  "ciphertext",
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.includes(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };
  const s = JSON.stringify(line);
  if (level === "error") console.error(s);
  else if (level === "warn") console.warn(s);
  else console.log(s);
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
};
