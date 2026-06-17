"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  saveCaptionEdit,
  regenerateImage,
  approveAndPublish,
  discardPost,
  uploadPostImage,
} from "@/app/actions/posts";

const MAX = 3000;

export interface PostEditorProps {
  postId: string;
  status: string;
  initial: { hook: string; body: string; cta: string; hashtags: string[] };
  imageUrl: string | null;
  linkedInConnected: boolean;
  authorName: string;
  authorAvatar: string | null;
}

export function PostEditor({
  postId,
  status,
  initial,
  imageUrl,
  linkedInConnected,
  authorName,
  authorAvatar,
}: PostEditorProps) {
  const router = useRouter();
  const [hook, setHook] = useState(initial.hook);
  const [body, setBody] = useState(initial.body);
  const [cta, setCta] = useState(initial.cta);
  const [hashtags, setHashtags] = useState(initial.hashtags.join(" "));
  const [alert, setAlert] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const published = status === "published";

  const assembled = [hook, "", body, "", cta, "", hashtags].join("\n").trim();
  const count = assembled.length;
  const over = count > MAX;
  const pct = Math.min(100, Math.round((count / MAX) * 100));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, refresh = true) {
    start(async () => {
      const r = await fn();
      setAlert({ ok: r.ok, text: r.message ?? (r.ok ? "Done." : "Something went wrong.") });
      if (r.ok && refresh) router.refresh();
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    run(() => uploadPostImage(postId, fd));
  }

  return (
    <div className="space-y-4">
      {alert && (
        <div
          className={`card p-3 text-sm animate-fade-in ${
            alert.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {alert.text}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* ---------------- Editor ---------------- */}
        <div className="card p-4 space-y-4">
          <h2 className="font-semibold text-gray-800">Edit</h2>

          {/* image */}
          <div className="space-y-2">
            <span className="label">Image</span>
            <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50 aspect-[1.91/1] grid place-items-center">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Post visual" className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-400 text-sm">No image</span>
              )}
            </div>
            {!published && (
              <div className="flex flex-wrap gap-2">
                <button disabled={pending} onClick={() => run(() => regenerateImage(postId))} className="btn-outline">
                  🔄 Regenerate
                </button>
                <button disabled={pending} onClick={() => fileRef.current?.click()} className="btn-outline">
                  ⬆️ Upload your own
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              </div>
            )}
          </div>

          <Field label="Hook" value={hook} onChange={setHook} rows={2} disabled={published} />
          <Field label="Body" value={body} onChange={setBody} rows={8} disabled={published} />
          <Field label="Call to action" value={cta} onChange={setCta} rows={2} disabled={published} />
          <Field
            label="Hashtags (space-separated)"
            value={hashtags}
            onChange={setHashtags}
            rows={1}
            disabled={published}
          />

          {/* char meter */}
          <div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full transition-all ${over ? "bg-red-500" : pct > 85 ? "bg-amber-500" : "bg-brand"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className={`text-xs mt-1 ${over ? "text-red-600" : "text-gray-500"}`}>
              {count} / {MAX} characters{over ? " — too long for LinkedIn" : ""}
            </div>
          </div>
        </div>

        {/* ---------------- Live preview ---------------- */}
        <div className="lg:sticky lg:top-20 space-y-2">
          <span className="label">Preview · how it looks on LinkedIn</span>
          <div className="card overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                {authorAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={authorAvatar} alt={authorName} className="w-12 h-12 rounded-full" />
                ) : (
                  <span className="grid place-items-center w-12 h-12 rounded-full bg-gray-200 text-gray-600 font-semibold">
                    {authorName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="leading-tight">
                  <div className="font-semibold text-gray-900 text-sm">{authorName}</div>
                  <div className="text-xs text-gray-500">Now · 🌐 Public</div>
                </div>
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                {renderCaption(assembled) || (
                  <span className="text-gray-400">Your caption preview…</span>
                )}
              </div>
            </div>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="w-full border-t border-gray-100" />
            )}
            <div className="flex justify-around text-gray-500 text-xs font-medium border-t border-gray-100 py-2">
              <span>👍 Like</span>
              <span>💬 Comment</span>
              <span>🔁 Repost</span>
              <span>➤ Send</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Action bar ---------------- */}
      {published ? (
        <div className="card p-4 border-green-200 bg-green-50 text-sm text-green-800">
          ✅ Published to LinkedIn.
        </div>
      ) : (
        <div className="sticky bottom-4 card p-3 flex flex-wrap items-center gap-3 shadow-lift">
          <button
            disabled={pending}
            onClick={() =>
              run(() =>
                saveCaptionEdit({
                  postId,
                  hook,
                  body,
                  cta,
                  hashtags: hashtags.split(/\s+/).filter(Boolean),
                }),
              )
            }
            className="btn-outline"
          >
            💾 Save edits
          </button>

          <button
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this draft permanently? This can't be undone.")) return;
              run(() => discardPost(postId).then((r) => { if (r.ok) router.push("/"); return r; }), false);
            }}
            className="btn-ghost hover:text-red-600"
          >
            🗑 Discard
          </button>

          <div className="flex-1" />

          {!linkedInConnected && (
            <span className="text-xs text-amber-700">Connect LinkedIn in Settings to publish</span>
          )}
          <button
            disabled={pending || over || !linkedInConnected}
            title={!linkedInConnected ? "Connect LinkedIn in Settings first" : ""}
            onClick={() => run(() => approveAndPublish(postId))}
            className="btn-primary"
          >
            {pending ? "Working…" : "Publish to LinkedIn"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Render caption text with highlighted #hashtags and preserved line breaks. */
function renderCaption(text: string) {
  if (!text) return null;
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {line.split(/(\s+)/).map((tok, j) =>
        tok.startsWith("#") ? (
          <span key={j} className="text-brand font-medium">
            {tok}
          </span>
        ) : (
          <span key={j}>{tok}</span>
        ),
      )}
      {"\n"}
    </span>
  ));
}

function Field({
  label,
  value,
  onChange,
  rows,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input resize-y"
      />
    </label>
  );
}
