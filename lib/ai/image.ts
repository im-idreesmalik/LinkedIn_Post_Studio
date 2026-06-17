/**
 * Image generation via Pollinations (free, keyless, no GPU required).
 *
 * Output is normalized to a LinkedIn-friendly 1.91:1 (1200x627) image plus a
 * thumbnail, uploaded to object storage. The DB stores only URLs.
 */
import sharp from "sharp";
import { putObject } from "@/lib/storage";
import { log } from "@/lib/logger";

const TARGET_W = 1200;
const TARGET_H = 627; // 1.91:1, LinkedIn landscape
const THUMB_W = 600;
const THUMB_H = 314;

export type ImageProviderName = "pollinations";

export interface RenderedImage {
  storageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  provider: ImageProviderName;
}

// ------------------------------------------------------- Pollinations (FLUX)
async function renderPollinations(prompt: string): Promise<Buffer> {
  // Use the high-quality FLUX model + prompt enhancement (still free, keyless).
  // Pollinations' free endpoint is flaky, so retry with backoff + a timeout.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000_000) + attempt;
    const params = new URLSearchParams({
      width: "1536",
      height: "806",
      model: "flux",
      enhance: "true",
      nologo: "true",
      seed: String(seed),
    });
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      prompt,
    )}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "image/*" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Pollinations ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) throw new Error("Pollinations returned an invalid image");
      return buf;
    } catch (err) {
      lastErr = err;
      log.warn("pollinations.retry", { attempt, error: String(err) });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Pollinations failed after 3 attempts: ${String(lastErr)}`);
}

// --------------------------------------------------------- public entry point
/**
 * Generate -> normalize to 1200x627 + thumbnail -> upload -> return URLs.
 * `keyPrefix` should be unique per image, e.g. `${userId}/${postId}/${ts}`.
 */
export async function createImageAsset(opts: {
  prompt: string;
  keyPrefix: string;
  provider?: ImageProviderName;
}): Promise<RenderedImage> {
  const provider = opts.provider ?? "pollinations";
  const raw = await renderPollinations(opts.prompt);

  const full = await sharp(raw)
    .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const thumb = await sharp(raw)
    .resize(THUMB_W, THUMB_H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  const main = await putObject(`${opts.keyPrefix}/image.png`, full, "image/png");
  const thumbnail = await putObject(`${opts.keyPrefix}/thumb.png`, thumb, "image/png");

  log.info("image.generated", { provider, key: opts.keyPrefix });
  return {
    storageUrl: main.url,
    thumbnailUrl: thumbnail.url,
    width: TARGET_W,
    height: TARGET_H,
    provider,
  };
}

/**
 * Store a user-uploaded image: cap width at 1200 (preserving aspect ratio),
 * make a thumbnail, upload both, and return the URLs + dimensions.
 */
export async function storeUploadedImage(opts: {
  bytes: Buffer;
  keyPrefix: string;
}): Promise<{ storageUrl: string; thumbnailUrl: string; width: number; height: number }> {
  const full = await sharp(opts.bytes)
    .rotate() // honor EXIF orientation
    .resize({ width: 1200, withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(full).metadata();
  const thumb = await sharp(opts.bytes)
    .rotate()
    .resize({ width: 600, withoutEnlargement: true })
    .png()
    .toBuffer();
  const main = await putObject(`${opts.keyPrefix}/upload.png`, full, "image/png");
  const thumbnail = await putObject(`${opts.keyPrefix}/upload-thumb.png`, thumb, "image/png");
  return {
    storageUrl: main.url,
    thumbnailUrl: thumbnail.url,
    width: meta.width ?? 1200,
    height: meta.height ?? 0,
  };
}

/**
 * Wrap a model-provided, post-specific visual concept with style + strict
 * anti-text guardrails. Keeps the image RELATED to the post (the concept comes
 * from the caption) while avoiding garbled text.
 */
export function buildImagePromptFromConcept(concept: string): string {
  return [
    concept.trim(),
    "Modern, minimalist, premium corporate art; cinematic soft lighting; rich tasteful colors;",
    "high detail; polished professional render.",
    "STRICTLY NO text, no letters, no numbers, no words, no screens, no monitors, no UI,",
    "no dashboards, no charts, no documents, no logos, no watermarks, no human faces.",
  ].join(" ");
}

/**
 * Turn a post concept into a brand-safe image prompt (fallback when no concept).
 *
 * IMPORTANT: diffusion models render gibberish text on screens/dashboards/
 * documents, which looks unprofessional. So we deliberately ask for an
 * ABSTRACT, metaphorical visual with NO text-bearing surfaces (no screens,
 * monitors, laptops, UI, documents, charts) — which keeps the result clean and
 * still thematically tied to the post.
 */
export function buildImagePrompt(topicTitle: string, niche?: string | null): string {
  return [
    `An abstract, conceptual illustration that symbolizes the idea of "${topicTitle}".`,
    niche ? `Theme: ${niche}.` : "",
    "Express it through visual metaphor — flowing light, interconnected geometric shapes,",
    "depth, motion, gradients — NOT literal devices.",
    "Modern, minimalist, premium corporate art; cinematic soft lighting; rich tasteful colors;",
    "high detail, polished 3D-render feel.",
    "STRICTLY NO text, no letters, no numbers, no words, no screens, no monitors, no laptops,",
    "no phones, no dashboards, no documents, no charts, no user interfaces, no logos,",
    "no watermarks, and no human faces.",
  ]
    .filter(Boolean)
    .join(" ");
}
