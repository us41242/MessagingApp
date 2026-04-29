import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchConversationsForUser } from "@/lib/conversations";
import { MobileHomeList } from "@/components/MobileHomeList";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user;
  if (!me) redirect("/login");

  const list = await fetchConversationsForUser(me.id);

  // Two-person setups: if there's exactly one conversation, jump straight in
  // so the sidebar isn't a redundant gate.
  if (list.length === 1) {
    redirect(`/c/${list[0].id}`);
  }

  return (
    <>
      {/* Mobile (no sidebar): full-screen conversation list */}
      <div className="flex flex-1 flex-col md:hidden">
        <MobileHomeList
          conversations={list}
          email={me.email ?? null}
        />
      </div>

      {/* Desktop: sidebar already shows the list, so the main panel is just an empty hint */}
      <div className="hidden flex-1 items-center justify-center bg-zinc-50 dark:bg-black md:flex">
        <div className="text-center">
          <h2 className="text-lg font-medium tracking-tight">
            Pick a conversation
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Or{" "}
            <Link href="/new" className="underline">
              start a new one
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
