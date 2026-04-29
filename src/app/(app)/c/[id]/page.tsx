import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Thread } from "@/components/Thread";
import type { MessageWithAttachments } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 80;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user;
  if (!me) return null;

  const { data: convo } = await supabase
    .from("conversations")
    .select(
      `
        id, title, telegram_chat_id, last_message_at,
        members:conversation_members ( profile_id, profiles ( id, display_name, avatar_url ) )
      `
    )
    .eq("id", id)
    .maybeSingle();

  if (!convo) notFound();

  type MemberRow = {
    profile_id: string;
    profiles:
      | { id: string; display_name: string | null; avatar_url: string | null }
      | null
      | Array<{ id: string; display_name: string | null; avatar_url: string | null }>;
  };
  const oneProfile = (m: MemberRow) =>
    Array.isArray(m.profiles) ? m.profiles[0] ?? null : m.profiles ?? null;
  const others = ((convo.members ?? []) as MemberRow[])
    .map(oneProfile)
    .filter((p): p is NonNullable<ReturnType<typeof oneProfile>> => !!p && p.id !== me.id);
  const headerTitle =
    convo.title ||
    others[0]?.display_name ||
    (convo.telegram_chat_id ? "Telegram chat" : "Conversation");

  const { data: rows } = await supabase
    .from("messages")
    .select(
      `
        id, conversation_id, sender_id, body, source, external_id,
        reply_to_id, reply_to_external_id, edited_at, previous_versions,
        deleted_at, location_label, location_lng, location_lat, sent_at, created_at,
        attachments ( * ),
        sender:profiles!sender_id ( id, display_name, avatar_url )
      `
    )
    .eq("conversation_id", id)
    .order("sent_at", { ascending: false })
    .limit(PAGE_SIZE);

  const initialMessages = (rows ?? []).reverse() as unknown as MessageWithAttachments[];

  return (
    <Thread
      conversationId={convo.id}
      headerTitle={headerTitle}
      meId={me.id}
      initialMessages={initialMessages}
    />
  );
}
