import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, postImages } from "@/lib/db/schema";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) return null;

  const rows = await db
    .select({
      id: posts.id,
      hook: posts.hook,
      body: posts.body,
      publishedAt: posts.publishedAt,
      scheduledDate: posts.scheduledDate,
      thumb: postImages.thumbnailUrl,
    })
    .from(posts)
    .leftJoin(postImages, eq(postImages.id, posts.selectedImageId))
    .where(and(eq(posts.userId, session.user.id), eq(posts.status, "published")))
    .orderBy(desc(posts.publishedAt))
    .limit(60);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">History</h1>
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-gray-500">
          <div className="text-3xl mb-2">📭</div>
          <p className="font-medium text-gray-700">Nothing published yet</p>
          <p className="text-sm mt-1">Published posts will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/posts/${p.id}`} className="card p-4 flex gap-4 hover:shadow-lift transition-shadow">
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt="" className="w-24 h-16 rounded-lg object-cover bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-24 h-16 rounded-lg bg-gray-100 grid place-items-center text-gray-400 shrink-0">✓</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">
                      {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : p.scheduledDate}
                    </span>
                    <span className="badge bg-green-100 text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Published
                    </span>
                  </div>
                  <p className="font-semibold text-gray-900 line-clamp-1">{p.hook || "Untitled"}</p>
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
