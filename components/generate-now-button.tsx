"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateNow } from "@/app/actions/posts";

export function GenerateNowButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-gray-500 hidden sm:inline">{msg}</span>}
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await generateNow();
            setMsg(r.message ?? null);
            [4000, 10000, 18000, 28000, 40000].forEach((ms) =>
              setTimeout(() => router.refresh(), ms),
            );
          })
        }
        className="btn-primary"
      >
        {pending ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <span>✨</span>
        )}
        {pending ? "Queuing…" : "Generate now"}
      </button>
    </div>
  );
}
