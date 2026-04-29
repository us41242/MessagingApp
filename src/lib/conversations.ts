import { createClient } from "@/lib/supabase/server";

export interface ConversationListItem {
  id: string;
  title: string;
  avatar_url: string | null;
  last_message_at: string;
  isTelegram: boolean;
}

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

export async function fetchConversationsForUser(
  meId: string
): Promise<ConversationListItem[]> {
  const supabase = await createClient();
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

  return ((convos ?? []) as ConvoRow[]).map((c) => {
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
}
