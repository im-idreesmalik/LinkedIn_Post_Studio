/**
 * Caption generation via a LOCAL model served by Ollama (no paid API).
 * Default model: qwen2.5:14b (configurable per user).
 *
 * Returns the caption as parts so the dashboard can edit each independently
 * and so engagement rules can be validated. See docs/03 §3.1 (A2/A3).
 */
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { chatJSON } from "@/lib/ai/llm";

export const LINKEDIN_MAX_CHARS = 3000;

export interface TopicInput {
  title: string;
  angle?: string | null;
  format?: string | null;
}

export interface CaptionInput {
  fingerprint: string; // the user's expertise/voice summary
  topic: TopicInput;
  tone?: string;
  model?: string;
  /** Article text to base the post on (from user-provided URLs). */
  sourceMaterial?: string;
  /** Ground the caption in live Google Search (Gemini only) for up-to-date facts. */
  grounded?: boolean;
}

export interface CaptionOutput {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  format: string;
  caption: string; // assembled, ready to publish (<= 3000 chars)
  imageConcept: string; // text-free visual concept for the post's image
}

const captionSchema = z.object({
  // .catch() keeps generation resilient if a smaller model omits or mistypes a
  // field — we still produce a usable draft for the user to edit.
  hook: z.string().catch(""),
  body: z.string().catch(""),
  cta: z.string().catch(""),
  hashtags: z.array(z.string()).catch([]),
  format: z.string().catch("story"),
  imageConcept: z.string().catch(""),
});

const SYSTEM_PROMPT = `You are an expert LinkedIn ghostwriter. Write ONE post in the author's voice.

GOAL: an INFORMATIONAL, value-first post that teaches or shares a genuinely useful insight,
written so ANY professional can understand and benefit — not just the author's narrow niche.
This broad accessibility is intentional: it maximizes reach and networking.

Rules:
- HOOK: 1-2 lines that stop the scroll; the key idea in the first ~140 characters. Plain
  language, no jargon wall.
- BODY: teach something concrete — an insight, lesson, framework, or a clear how/why. Make it
  broadly relatable and briefly explain any niche term so outsiders get value too. Short,
  scannable paragraphs with line breaks.
- CTA: one networking-friendly ask — invite people to share their experience, weigh in, or
  connect (an open question works well).
- HASHTAGS: 3-5, mixing niche tags with broader professional tags for wider reach; each
  starts with #, no spaces.
- Keep the whole post well under 3000 characters.
- Match the author's tone. NEVER fabricate statistics, certifications, achievements, or
  personal stories. If you don't know a fact, speak generally instead of inventing one.
- IMAGECONCEPT: one vivid sentence describing a REAL-WORLD METAPHOR or abstract scene that
  represents the post's core idea (e.g., a lighthouse guiding ships, a sturdy bridge, flowing
  water, mountains at sunrise, interlocking gears, a compass, a network of glowing nodes in
  open space, a single sprouting plant). Do NOT describe software, applications, app
  interfaces, screens, monitors, laptops, phones, code, blueprints, diagrams, dashboards,
  charts, documents, or any device — those make image models render unreadable gibberish text.
  No text, words, logos, or human faces. Describe only the metaphorical subject and mood.
Respond with ONLY a JSON object:
{"hook","body","cta","hashtags":[],"format","imageConcept"}.`;

function assemble(c: z.infer<typeof captionSchema>): string {
  const tags = c.hashtags
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`))
    .join(" ");
  let full = [c.hook, "", c.body, "", c.cta, "", tags].join("\n").trim();
  if (full.length > LINKEDIN_MAX_CHARS) full = full.slice(0, LINKEDIN_MAX_CHARS - 1).trim();
  return full;
}

export async function generateCaption(input: CaptionInput): Promise<CaptionOutput> {
  const model = input.model ?? env.OLLAMA_CAPTION_MODEL;
  const userPrompt = [
    `AUTHOR PROFILE / VOICE:\n${input.fingerprint}`,
    `TONE: ${input.tone ?? "professional, warm, concise"}`,
    `TOPIC: ${input.topic.title}`,
    input.topic.angle ? `ANGLE: ${input.topic.angle}` : "",
    input.topic.format ? `FORMAT: ${input.topic.format}` : "",
    input.sourceMaterial
      ? `SOURCE MATERIAL — base the post on this. Summarize the most useful, accurate points in the author's voice and add a brief perspective/takeaway. Do NOT copy verbatim, and do NOT invent quotes, names, or statistics beyond what's here:\n${input.sourceMaterial}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await chatJSON({
    model,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.8,
    grounded: input.grounded,
  });
  const parsed = captionSchema.parse(JSON.parse(raw));
  const caption = assemble(parsed);

  log.info("caption.generated", { model, chars: caption.length });

  return {
    hook: parsed.hook,
    body: parsed.body,
    cta: parsed.cta,
    hashtags: parsed.hashtags,
    format: parsed.format,
    caption,
    imageConcept: parsed.imageConcept,
  };
}
