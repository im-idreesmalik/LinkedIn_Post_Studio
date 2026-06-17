"use client";

import { useState, useTransition } from "react";
import { sendTestEmail } from "@/app/actions/onboarding";

export function TestEmailButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("Sending…");
            const r = await sendTestEmail();
            setMsg(r.message ?? null);
          })
        }
        className="btn-outline"
      >
        {pending ? "Sending…" : "Send test email"}
      </button>
      {msg && <p className="text-xs text-gray-600 mt-2">{msg}</p>}
    </div>
  );
}
