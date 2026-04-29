import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarConversations } from "@/components/SidebarConversations";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: convos } = await supabase
    .from("conversations")
    .select(
      `
        id,
        title,
        last_message_at,
        telegram_chat_id,
        members:conversation_members!inner ( profile_id, profiles ( id, display_name, avatar_url ) )
      `
    )
    .order("last_message_at", { ascending: false });

  const meId = userData.user.id;

  // PostgREST returns the joined `profiles` as an object for many-to-one,
  // but supabase-js without generated types infers it as object|object[].
  // Coerce to a single profile here.
  type MemberRow = {
    profile_id: string;
    profiles:
      | { id: string; display_name: string | null; avatar_url: string | null }
      | null
      | Array<{ id: string; display_name: string | null; avatar_url: string | null }>;
  };
  type ConvoRow = {
    id: string;
    title: string | null;
    last_message_at: string;
    telegram_chat_id: number | null;
    members: MemberRow[] | null;
  };
  const oneProfile = (m: MemberRow) =>
    Array.isArray(m.profiles) ? m.profiles[0] ?? null : m.profiles ?? null;

  const list = ((convos ?? []) as ConvoRow[]).map((c) => {
    const others = (c.members ?? [])
      .map(oneProfile)
      .filter((p): p is NonNullable<ReturnType<typeof oneProfile>> => !!p && p.id !== meId);
    const other = others[0] ?? null;
    return {
      id: c.id,
      title:
        c.title ||
        other?.display_name ||
        (c.telegram_chat_id ? "Telegram chat" : "New conversation"),
      avatar_url: other?.avatar_url ?? null,
      last_message_at: c.last_message_at,
      isTelegram: c.telegram_chat_id != null,
    };
  });

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h1 className="text-sm font-semibold tracking-tight">Messages</h1>
          <Link
            href="/new"
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            New
          </Link>
        </header>
        <SidebarConversations conversations={list} />
        <footer className="border-t border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="truncate">{userData.user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Sign out
              </button>
            </form>
          </div>
        </footer>
      </aside>
      <section className="flex flex-1 flex-col overflow-hidden">{children}</section>
    </div>
  );
}
