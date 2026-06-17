"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateFromTopic } from "@/app/actions/posts";

const TONES = [
  "Professional",
  "Conversational",
  "Storytelling",
  "Bold / contrarian",
  "Educational",
  "Inspirational",
];

export function TopicGenerator() {
  const [topic, setTopic] = useState("");
  const [urls, setUrls] = useState("");
  const [tone, setTone] = useState(TONES[0]);
  const [showUrls, setShowUrls] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    if (!topic.trim() && !urls.trim()) return;
    start(async () => {
      setMsg(
        urls.trim()
          ? "Reading the article(s) and writing a summary…"
          : "Generating from your topic…",
      );
      const r = await generateFromTopic(topic, tone, urls);
      setMsg(r.message ?? null);
      if (r.ok) {
        setTopic("");
        setUrls("");
        router.refresh();
      }
    });
  }

  return (
    <div className="card p-4">
      <label className="label">✍️ Compose a post</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={topic}
          disabled={pending}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="What do you want to post about?"
          className="input flex-1"
        />
        <select
          value={tone}
          disabled={pending}
          onChange={(e) => setTone(e.target.value)}
          className="input sm:w-44"
          title="Tone"
        >
          {TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={pending || (!topic.trim() && !urls.trim())}
          className="btn-primary whitespace-nowrap"
        >
          {pending && <Spinner />}
          {pending ? "Generating…" : "Generate"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowUrls((v) => !v)}
        className="mt-2 text-xs text-brand hover:underline"
      >
        {showUrls ? "− Hide article links" : "+ Summarize from article link(s)"}
      </button>

      {showUrls && (
        <textarea
          value={urls}
          disabled={pending}
          onChange={(e) => setUrls(e.target.value)}
          rows={2}
          placeholder="Paste blog/article URL(s) to summarize — one per line."
          className="input mt-2 animate-fade-in"
        />
      )}

      {msg && <p className="text-xs text-gray-500 mt-2">{msg}</p>}
      <p className="text-xs text-gray-400 mt-2">
        With links → summarizes those articles. Without → uses live up-to-date search. Adds a
        new draft; you still review &amp; publish.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
