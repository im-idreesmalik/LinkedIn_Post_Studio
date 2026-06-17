import { eq } from "drizzle-orm";
import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { expertiseProfiles, userSkills, userSettings, users } from "@/lib/db/schema";
import { hasLinkedInConnection } from "@/lib/linkedin/store";
import { OnboardingForm } from "@/components/onboarding-form";
import { SyncLinkedInButton } from "@/components/sync-linkedin-button";
import { TestEmailButton } from "@/components/test-email-button";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const userId = session.user.id;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db
    .select()
    .from(expertiseProfiles)
    .where(eq(expertiseProfiles.userId, userId))
    .limit(1);
  const skills = await db
    .select({ name: userSkills.name })
    .from(userSkills)
    .where(eq(userSkills.userId, userId));
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const connected = await hasLinkedInConnection(userId);

  const notificationEmail = settings?.notificationEmail ?? user?.email ?? "";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-5">
        <h2 className="font-semibold mb-2 flex items-center gap-2">
          <span className="grid place-items-center w-6 h-6 rounded bg-brand text-white text-xs">in</span>
          LinkedIn connection
        </h2>
        {connected ? (
          <>
            <p className="badge bg-green-100 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Connected — publishing enabled
            </p>
            <SyncLinkedInButton />
          </>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("linkedin", { redirectTo: "/settings" });
            }}
          >
            <p className="text-sm text-amber-700 mb-2">
              Not connected — you can generate drafts but not publish.
            </p>
            <button className="btn-primary">Connect LinkedIn</button>
          </form>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-1">📧 Email notifications</h2>
        <p className="text-sm text-gray-600">
          Daily &quot;post ready&quot; emails go to{" "}
          <strong>{notificationEmail || "(set in the form below)"}</strong>.
        </p>
        <TestEmailButton />
      </section>

      <section>
        <h2 className="font-semibold mb-2">🧠 Your expertise &amp; schedule</h2>
        <OnboardingForm
          key={notificationEmail}
          initial={{
            headline: profile?.headline ?? "",
            bio: profile?.bio ?? "",
            industry: profile?.industry ?? "",
            niche: profile?.niche ?? "",
            targetAudience: profile?.targetAudience ?? "",
            contentPillars: (profile?.contentPillars ?? []).join(", "),
            skills: skills.map((s) => s.name).join(", "),
            samplePosts: (profile?.samplePosts ?? []).join("\n---\n"),
            timezone: settings?.timezone ?? "UTC",
            generationHour: Number(String(settings?.generationTimeLocal ?? "07").slice(0, 2)),
            notificationEmail,
          }}
        />
      </section>
    </div>
  );
}
