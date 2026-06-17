/**
 * Fetch a blog/article URL and extract its readable text, so a post can be
 * written based on it. Basic HTML-to-text (no extra deps), with a timeout,
 * content-type check, and a guard against internal/private addresses (SSRF).
 */
import { log } from "@/lib/logger";

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|172\.(1[6-9]|2\d|3[01])\.)/i;

function htmlToText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer the main article body when present.
  const main =
    t.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    t.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    t;

  let text = main.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/** Fetch one URL and return cleaned article text (truncated). */
export async function fetchArticleText(rawUrl: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http/https URLs are allowed");
  if (PRIVATE_HOST.test(u.hostname)) throw new Error("That address isn't allowed");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkedInPostStudio/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status})`);
    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = ct.includes("text/html") ? htmlToText(body) : body.replace(/\s+/g, " ").trim();
    if (text.length < 100) throw new Error("Couldn't extract readable text from that page");
    return text.slice(0, 8000);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch several URLs (best-effort) and combine their text for the LLM. */
export async function fetchSources(urls: string[], max = 3): Promise<string> {
  const picked = urls.filter(Boolean).slice(0, max);
  const chunks: string[] = [];
  for (const url of picked) {
    try {
      const text = await fetchArticleText(url);
      chunks.push(`SOURCE (${url}):\n${text}`);
    } catch (err) {
      log.warn("fetch_source.failed", { url, error: String(err) });
    }
  }
  return chunks.join("\n\n---\n\n").slice(0, 14000);
}
