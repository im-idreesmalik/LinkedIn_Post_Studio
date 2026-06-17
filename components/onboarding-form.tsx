"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOnboarding } from "@/app/actions/onboarding";

export interface OnboardingInitial {
  headline: string;
  bio: string;
  industry: string;
  niche: string;
  targetAudience: string;
  contentPillars: string;
  skills: string;
  samplePosts: string;
  timezone: string;
  generationHour: number;
  notificationEmail: string;
}

export function OnboardingForm({
  initial,
  redirectTo,
}: {
  initial: Partial<OnboardingInitial>;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState<OnboardingInitial>({
    headline: initial.headline ?? "",
    bio: initial.bio ?? "",
    industry: initial.industry ?? "",
    niche: initial.niche ?? "",
    targetAudience: initial.targetAudience ?? "",
    contentPillars: initial.contentPillars ?? "",
    skills: initial.skills ?? "",
    samplePosts: initial.samplePosts ?? "",
    timezone:
      initial.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    generationHour: initial.generationHour ?? 7,
    notificationEmail: initial.notificationEmail ?? "",
  });

  const set = (k: keyof OnboardingInitial) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  function submit() {
    start(async () => {
      const r = await saveOnboarding({
        headline: v.headline,
        bio: v.bio,
        industry: v.industry,
        niche: v.niche,
        targetAudience: v.targetAudience,
        contentPillars: v.contentPillars.split(",").map((s) => s.trim()).filter(Boolean),
        skills: v.skills.split(",").map((s) => s.trim()).filter(Boolean),
        samplePosts: v.samplePosts.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean),
        timezone: v.timezone,
        generationHour: Number(v.generationHour),
        notificationEmail: v.notificationEmail,
      });
      setMsg(r.message ?? null);
      if (r.ok && redirectTo) router.push(redirectTo);
    });
  }

  return (
    <div className="card p-5 space-y-5">
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Text label="Headline" value={v.headline} onChange={set("headline")} placeholder="Oracle APEX developer, ERP solutions" />
          <Text label="Industry" value={v.industry} onChange={set("industry")} placeholder="Enterprise Software" />
          <Text label="Niche" value={v.niche} onChange={set("niche")} placeholder="Oracle APEX / ERP development" />
          <Text label="Target audience" value={v.targetAudience} onChange={set("targetAudience")} placeholder="Tech leaders, fellow developers" />
        </div>
        <Text label="Skills (comma-separated)" value={v.skills} onChange={set("skills")} placeholder="PL/SQL, REST APIs, low-code, ETL" />
        <Text label="Content pillars (comma-separated)" value={v.contentPillars} onChange={set("contentPillars")} placeholder="how-tos, lessons learned, industry takes" />
        <Area label="Short bio / about" value={v.bio} onChange={set("bio")} rows={3} />
      </div>

      <div className="border-t border-gray-100 pt-4">
        <Area
          label="Your own past posts (paste 2–5, separate each with a line of ---)"
          value={v.samplePosts}
          onChange={set("samplePosts")}
          rows={6}
          placeholder={"First post text...\n---\nSecond post text..."}
        />
        <p className="text-xs text-gray-400 mt-1">This teaches the tool your writing voice.</p>
      </div>

      <div className="border-t border-gray-100 pt-4 grid sm:grid-cols-3 gap-3">
        <Text label="Notification email" value={v.notificationEmail} onChange={set("notificationEmail")} placeholder="you@example.com" />
        <Text label="Timezone (IANA)" value={v.timezone} onChange={set("timezone")} />
        <label className="block">
          <span className="label">Daily prep hour (0–23)</span>
          <input
            type="number"
            min={0}
            max={23}
            value={v.generationHour}
            onChange={(e) => setV((s) => ({ ...s, generationHour: Number(e.target.value) }))}
            className="input"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} onClick={submit} className="btn-primary">
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
      </div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input value={value} placeholder={placeholder} onChange={onChange} className="input" />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea value={value} rows={rows} placeholder={placeholder} onChange={onChange} className="input resize-y" />
    </label>
  );
}
