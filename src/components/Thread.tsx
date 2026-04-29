"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Attachment,
  MessageWithAttachments,
} from "@/lib/supabase/types";
import { kindFromMime } from "@/lib/media";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import { ThreadDrawer } from "@/components/ThreadDrawer";

type SupabaseClient = ReturnType<typeof createClient>;

export function Thread({
  conversationId,
  headerTitle,
  meId,
  initialMessages,
}: {
  conversationId: string;
  headerTitle: string;
  meId: string;
  initialMessages: MessageWithAttachments[];
}) {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [messages, setMessages] = useState<MessageWithAttachments[]>(
    initialMessages
  );
  const [drawerTab, setDrawerTab] = useState<"closed" | "search" | "media">(
    "closed"
  );

  // Map of message_id -> message index, useful for fast realtime patches.
  const messagesById = useMemo(() => {
    const m = new Map<string, number>();
    messages.forEach((msg, i) => m.set(msg.id, i));
    return m;
  }, [messages]);

  const upsertMessage = useCallback(
    (m: MessageWithAttachments) => {
      setMessages((prev) => {
        const idx = prev.findIndex((x) => x.id === m.id);
        if (idx === -1) {
          return [...prev, m].sort((a, b) =>
            a.sent_at < b.sent_at ? -1 : 1
          );
        }
        const next = prev.slice();
        next[idx] = { ...prev[idx], ...m };
        return next;
      });
    },
    []
  );

  const upsertAttachment = useCallback((a: Attachment) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === a.message_id);
      if (idx === -1) return prev;
      const next = prev.slice();
      const cur = prev[idx];
      const existing = cur.attachments.findIndex((x) => x.id === a.id);
      const atts =
        existing === -1
          ? [...cur.attachments, a]
          : cur.attachments.map((x, i) => (i === existing ? a : x));
      next[idx] = { ...cur, attachments: atts };
      return next;
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // Realtime: messages + attachments scoped to this conversation
  useEffect(() => {
    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as MessageWithAttachments;
          // Skip our own optimistic inserts (already in state by id).
          if (messagesById.has(row.id)) return;
          // Re-fetch with attachments + sender to keep shape consistent.
          const { data } = await supabase
            .from("messages")
            .select(
              `id, conversation_id, sender_id, body, source, external_id,
               reply_to_id, reply_to_external_id, edited_at, previous_versions,
               deleted_at, location_label, location_lng, location_lat, sent_at, created_at,
               attachments ( * ),
               sender:profiles!sender_id ( id, display_name, avatar_url )`
            )
            .eq("id", row.id)
            .maybeSingle();
          if (data) upsertMessage(data as unknown as MessageWithAttachments);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageWithAttachments;
          if (row.deleted_at) {
            removeMessage(row.id);
            return;
          }
          // Patch: only fields that can change post-insert.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id
                ? {
                    ...m,
                    body: row.body,
                    edited_at: row.edited_at,
                    previous_versions: row.previous_versions,
                  }
                : m
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attachments",
        },
        (payload) => {
          const a = payload.new as Attachment;
          upsertAttachment(a);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    supabase,
    conversationId,
    messagesById,
    upsertMessage,
    upsertAttachment,
    removeMessage,
  ]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              {headerTitle}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <DrawerTabButton
              active={drawerTab === "search"}
              onClick={() =>
                setDrawerTab(drawerTab === "search" ? "closed" : "search")
              }
              label="Search"
              icon={<SearchIcon />}
            />
            <DrawerTabButton
              active={drawerTab === "media"}
              onClick={() =>
                setDrawerTab(drawerTab === "media" ? "closed" : "media")
              }
              label="Media"
              icon={<ImageIcon />}
            />
          </div>
        </header>

        <MessageList
          conversationId={conversationId}
          messages={messages}
          meId={meId}
          onEdit={async (id, body) => {
            const { error } = await supabase
              .from("messages")
              .update({ body })
              .eq("id", id);
            if (error) alert(error.message);
          }}
          onDelete={async (id) => {
            if (!confirm("Delete this message?")) return;
            const { error } = await supabase
              .from("messages")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", id);
            if (error) alert(error.message);
            else removeMessage(id);
          }}
        />

        <Composer
          conversationId={conversationId}
          meId={meId}
          onOptimisticInsert={upsertMessage}
        />
      </div>

      {drawerTab !== "closed" ? (
        <ThreadDrawer
          tab={drawerTab}
          conversationId={conversationId}
          messages={messages}
          onClose={() => setDrawerTab("closed")}
          onJump={(messageId) => {
            const el = document.getElementById(`msg-${messageId}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-amber-400");
              setTimeout(
                () => el.classList.remove("ring-2", "ring-amber-400"),
                1500
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DrawerTabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
        active ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      {icon}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { kindFromMime };
