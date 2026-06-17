import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import "./globals.css";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { NavLinks } from "@/components/nav-links";

export const metadata: Metadata = {
  title: "LinkedIn Post Studio",
  description: "Generate, review, and publish LinkedIn posts — review gate required.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  let me: { name: string | null; avatarUrl: string | null } | null = null;
  if (session?.user?.id) {
    const [u] = await db
      .select({ name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    me = u ?? null;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen" suppressHydrationWarning>
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-bold text-brand">
              <span className="grid place-items-center w-7 h-7 rounded-md bg-brand text-white text-sm">
                in
              </span>
              <span className="hidden sm:inline">Post Studio</span>
            </Link>

            {session?.user ? (
              <nav className="flex items-center gap-1 sm:gap-2">
                <NavLinks />
                <div className="flex items-center gap-2 pl-2 ml-1 border-l border-gray-200">
                  {me?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={me.avatarUrl}
                      alt={me?.name ?? "You"}
                      className="w-8 h-8 rounded-full border border-gray-200"
                    />
                  ) : (
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-gray-200 text-gray-600 text-sm font-semibold">
                      {(me?.name ?? "U").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/" });
                    }}
                  >
                    <button className="btn-ghost">Sign out</button>
                  </form>
                </div>
              </nav>
            ) : null}
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8 animate-fade-in">{children}</main>
      </body>
    </html>
  );
}
