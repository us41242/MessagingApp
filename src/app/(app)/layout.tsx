import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarConversations } from "@/components/SidebarConversations";
import { NewMessageWatcher } from "@/components/NewMessageWatcher";
import { fetchConversationsForUser } from "@/lib/conversations";

// Layout reads cookies + per-user data; force dynamic so Next 16 doesn't
// serve one user's render to another.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const list = await fetchConversationsForUser(userData.user.id);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Desktop sidebar — hidden on mobile, fullscreen list rendered at / instead */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Messages
          </Link>
          <Link
            href="/new"
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            New
          </Link>
        </header>
        <SidebarConversations conversations={list} />
        <footer className="space-y-2 border-t border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{userData.user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Sign out
              </button>
            </form>
          </div>
          <NewMessageWatcher
            meId={userData.user.id}
            email={userData.user.email ?? null}
          />
        </footer>
      </aside>
      <section className="flex flex-1 flex-col overflow-hidden">{children}</section>
    </div>
  );
}
