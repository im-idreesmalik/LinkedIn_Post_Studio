"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncLinkedInProfile } from "@/app/actions/onboarding";

export function SyncLinkedInButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<{
    name: string | null;
    email: string | null;
    picture: string | null;
  } | null>(null);
  const router = useRouter();

  return (
    <div className="mt-3">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncLinkedInProfile();
            setMsg(r.message ?? null);
            if (r.ok && r.info) setInfo(r.info);
            if (r.ok) router.refresh();
          })
        }
        className="btn-outline mt-1"
      >
        {pending ? "Fetching…" : "Sync details from LinkedIn"}
      </button>

      {msg && <p className="text-xs text-gray-600 mt-2">{msg}</p>}

      {info && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          {info.picture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.picture}
              alt="LinkedIn profile"
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <div className="font-medium">{info.name}</div>
            <div className="text-gray-500">{info.email}</div>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">
        LinkedIn only exposes your name, email, and photo to apps. Your headline, bio,
        industry, and skills below must be entered manually.
      </p>
    </div>
  );
}
