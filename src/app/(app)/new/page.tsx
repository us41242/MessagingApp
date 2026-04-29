import { createClient } from "@/lib/supabase/server";
import { StartConversationButton } from "@/components/StartConversationButton";

export default async function NewConversationPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user;
  if (!me) return null;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .neq("id", me.id)
    .eq("is_ghost", false)
    .order("display_name", { ascending: true })
    .limit(200);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-xl">
        <h2 className="text-lg font-semibold tracking-tight">
          Start a conversation
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Pick someone from the directory.
        </p>

        <ul className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {(profiles ?? []).length === 0 ? (
            <li className="p-6 text-center text-sm text-zinc-500">
              No other users have signed up yet. Share the URL with someone.
            </li>
          ) : (
            (profiles ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {(p.display_name || p.username || "?")
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {p.display_name || p.username || "(no name)"}
                    </div>
                    {p.username ? (
                      <div className="truncate text-xs text-zinc-500">
                        @{p.username}
                      </div>
                    ) : null}
                  </div>
                </div>
                <StartConversationButton otherProfileId={p.id} />
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
