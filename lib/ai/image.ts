/**
 * Image generation via LOCAL Stable Diffusion (SDXL) served by ComfyUI.
 * No paid API. A keyless Pollinations fallback is included for machines
 * without a GPU (disabled by default; selected per user/provider).
 *
 * Output is normalized to a LinkedIn-friendly 1.91:1 (1200x627) image plus a
 * thumbnail, uploaded to object storage. The DB stores only URLs.
 */
import sharp from "sharp";
import { env } from "@/lib/env";
import { putObject } from "@/lib/storage";
import { log } from "@/lib/logger";

const TARGET_W = 1200;
const TARGET_H = 627; // 1.91:1, LinkedIn landscape
const THUMB_W = 600;
const THUMB_H = 314;

export type ImageProviderName = "stable_diffusion" | "pollinations" | "gemini";

export interface RenderedImage {
  storageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  provider: ImageProviderName;
}

const NEGATIVE =
  "text, watermark, logo, deformed, low quality, blurry, extra fingers, real person face";

/** Raw bytes from the selected backend (before normalization). */
async function renderRaw(
  prompt: string,
  provider: ImageProviderName,
): Promise<Buffer> {
  if (provider === "gemini") return renderGemini(prompt);
  if (provider === "pollinations") return renderPollinations(prompt);
  return renderComfyUI(prompt);
}

// ------------------------------------------ Gemini 2.5 Flash Image (Nano Banana)
async function renderGemini(prompt: string): Promise<Buffer> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const model = "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                prompt +
                " Wide 16:9 landscape composition suitable as a LinkedIn header image.",
            },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    throw new Error("Gemini returned no image data");
  }
  return Buffer.from(img.inlineData.data, "base64");
}

// ---------------------------------------------------------- ComfyUI (SDXL)
function sdxlWorkflow(prompt: string, seed: number) {
  // Minimal SDXL txt2img graph. Node ids are arbitrary strings.
  return {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: env.COMFYUI_SDXL_CHECKPOINT },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1216, height: 832, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: NEGATIVE, clip: ["4", 1] },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 28,
        cfg: 7,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "studio", images: ["8", 0] },
    },
  };
}

async function renderComfyUI(prompt: string): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 1_000_000_000_000);
  const clientId = `studio-${seed}`;

  const submit = await fetch(`${env.COMFYUI_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: sdxlWorkflow(prompt, seed), client_id: clientId }),
  });
  if (!submit.ok) throw new Error(`ComfyUI submit ${submit.status}: ${await submit.text()}`);
  const { prompt_id } = (await submit.json()) as { prompt_id: string };

  // Poll history until the SaveImage node produces an output.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const h = await fetch(`${env.COMFYUI_BASE_URL}/history/${prompt_id}`);
    if (h.ok) {
      const hist = (await h.json()) as Record<string, any>;
      const entry = hist[prompt_id];
      const images = entry?.outputs?.["9"]?.images;
      if (images && images.length) {
        const img = images[0];
        const q = new URLSearchParams({
          filename: img.filename,
          subfolder: img.subfolder ?? "",
          type: img.type ?? "output",
        });
        const view = await fetch(`${env.COMFYUI_BASE_URL}/view?${q}`);
        if (!view.ok) throw new Error(`ComfyUI view ${view.status}`);
        return Buffer.from(await view.arrayBuffer());
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("ComfyUI generation timed out");
}

// ---------------------------------------------- Pollinations (no-GPU fallback)
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
  const provider = opts.provider ?? "stable_diffusion";
  const raw = await renderRaw(opts.prompt, provider);

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
