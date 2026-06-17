/**
 * Text LLM router — returns a JSON string from either:
 *   - Google Gemini (free-tier text) when the model id starts with "gemini", or
 *   - a local Ollama model otherwise.
 *
 * Images on Gemini are paid-only, but TEXT generation is free-tier, so we use
 * Gemini for high-quality captions/topics while keeping Ollama as an offline
 * fallback. See docs/06 §6.3/§6.4.
 */
import { env } from "@/lib/env";

export interface ChatJSONOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  /** Gemini only: ground the response in live Google Search (up-to-date data). */
  grounded?: boolean;
}

export async function chatJSON(opts: ChatJSONOptions): Promise<string> {
  return opts.model.startsWith("gemini") ? geminiJSON(opts) : ollamaJSON(opts);
}

/** Pull a JSON object out of a (possibly markdown-wrapped) text response. */
function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim() || "{}";
}

async function ollamaJSON({ model, system, user, temperature = 0.8 }: ChatJSONOptions) {
  const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "{}";
}

async function geminiJSON(opts: ChatJSONOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const { model, system, user, temperature = 0.8, grounded } = opts;

  async function call(useGrounding: boolean): Promise<string> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      // JSON mode (responseMimeType) can't be combined with tools, so when
      // grounding we ask for JSON in the prompt and extract it from the text.
      generationConfig: useGrounding
        ? { temperature }
        : { responseMimeType: "application/json", temperature },
      ...(useGrounding ? { tools: [{ google_search: {} }] } : {}),
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") || "{}";
    return useGrounding ? extractJSON(text) : text;
  }

  if (grounded) {
    try {
      return await call(true);
    } catch {
      // Grounding may be unavailable/limited — fall back to a normal call.
      return await call(false);
    }
  }
  return call(false);
}
