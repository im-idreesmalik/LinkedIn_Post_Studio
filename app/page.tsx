import Link from "next/link";
import { and, eq, inArray, desc } from "drizzle-orm";
import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, postImages, expertiseProfiles } from "@/lib/db/schema";
import { GenerateNowButton } from "@/components/generate-now-button";
import { TopicGenerator } from "@/components/topic-generator";
import { StatusBadge } from "@/components/status-badge";

export default async function Home() {
  const session = await auth();

  // ---- Logged out: landing ----
  if (!session?.user) {
    return (
      <div className="space-y-6">
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand to-brand-dark text-white px-8 py-12 text-center">
            <h1 className="text-3xl font-bold mb-3">Show up on LinkedIn, effortlessly</h1>
            <p className="text-white/90 max-w-md mx-auto mb-7">
              A fresh post is drafted for you every day — caption and image included.
              You review, tweak, and publish. Nothing posts without your click.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("linkedin", { redirectTo: "/" });
              }}
            >
              <button className="bg-white text-brand font-semibold px-6 py-3 rounded-full hover:bg-gray-100 transition-colors">
                Sign in with LinkedIn
              </button>
            </form>
          </div>
        </section>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            ["🧠", "Tailored topics", "From your expertise and current, up-to-date trends."],
            ["✍️", "Ready-to-post drafts", "Caption, image, and hashtags — in your voice."],
            ["✅", "You stay in control", "Review and edit every post before it goes live."],
          ].map(([icon, title, desc]) => (
            <div key={title} className="card p-5">
              <div className="text-2xl mb-2">{icon}</div>
              <div className="font-semibold mb-1">{title}</div>
              <div className="text-sm text-gray-600">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const userId = session.user.id;

  const [profile] = await db
    .select({ fingerprint: expertiseProfiles.fingerprint })
    .from(expertiseProfiles)
    .where(eq(expertiseProfiles.userId, userId))
    .limit(1);
  const needsOnboarding = !profile?.fingerprint;

  const inbox = await db
    .select({
      id: posts.id,
      status: posts.status,
      scheduledDate: posts.scheduledDate,
      hook: posts.hook,
      body: posts.body,
      thumb: postImages.thumbnailUrl,
    })
    .from(posts)
    .leftJoin(postImages, eq(postImages.id, posts.selectedImageId))
    .where(
      and(
        eq(posts.userId, userId),
        inArray(posts.status, [
          "generating",
          "in_review",
          "edited",
          "generation_failed",
          "publish_failed",
          "approved",
        ]),
      ),
    )
    .orderBy(desc(posts.scheduledDate), desc(posts.createdAt))
    .limit(30);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Today</h1>
        <GenerateNowButton />
      </div>

      {needsOnboarding && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-sm flex items-center justify-between gap-3">
          <span>👋 Finish setup so we can tailor your posts to your expertise.</span>
          <Link href="/settings" className="btn-primary whitespace-nowrap">
            Add expertise
          </Link>
        </div>
      )}

      <TopicGenerator />

      <div className="flex items-center justify-between pt-1">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Your drafts
        </h2>
        <span className="text-xs text-gray-400">{inbox.length} pending</span>
      </div>

      {inbox.length === 0 ? (
        <div className="card p-10 text-center text-gray-500">
          <div className="text-3xl mb-2">🗒️</div>
          <p className="font-medium text-gray-700">No drafts yet</p>
          <p className="text-sm mt-1">
            Use <strong>Generate now</strong>, write a topic above, or wait for today&apos;s
            scheduled draft.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {inbox.map((p) => (
            <li key={p.id}>
              <Link
                href={`/posts/${p.id}`}
                className="card p-4 flex gap-4 hover:shadow-lift transition-shadow"
              >
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumb}
                    alt=""
                    className="w-24 h-16 rounded-lg object-cover bg-gray-100 shrink-0"
                  />
                ) : (
                  <div className="w-24 h-16 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 grid place-items-center text-gray-400 shrink-0">
                    {p.status === "generating" ? "…" : "✎"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-gray-400">{p.scheduledDate}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="font-semibold text-gray-900 line-clamp-1">
                    {p.hook || "Untitled draft"}
                  </p>
                  <p className="text-sm text-gray-500 line-clamp-2">{p.body}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
