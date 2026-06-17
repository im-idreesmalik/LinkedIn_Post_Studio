import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, postImages, users } from "@/lib/db/schema";
import { hasLinkedInConnection } from "@/lib/linkedin/store";
import { PostEditor } from "@/components/post-editor";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) notFound();
  const userId = session.user.id;

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .limit(1);
  if (!post) notFound();

  let imageUrl: string | null = null;
  if (post.selectedImageId) {
    const [img] = await db
      .select({ url: postImages.storageUrl })
      .from(postImages)
      .where(eq(postImages.id, post.selectedImageId))
      .limit(1);
    imageUrl = img?.url ?? null;
  }

  const [me] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const connected = await hasLinkedInConnection(userId);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-brand">
          ← Back to drafts
        </Link>
        <h1 className="text-2xl font-bold mt-1">Review &amp; publish</h1>
        <p className="text-sm text-gray-500">
          Edit anything below. Nothing is posted until you click Publish.
        </p>
      </div>
      <PostEditor
        postId={post.id}
        status={post.status}
        initial={{
          hook: post.hook ?? "",
          body: post.body ?? "",
          cta: post.cta ?? "",
          hashtags: (post.hashtags as string[]) ?? [],
        }}
        imageUrl={imageUrl}
        linkedInConnected={connected}
        authorName={me?.name ?? "You"}
        authorAvatar={me?.avatarUrl ?? null}
      />
    </div>
  );
}
