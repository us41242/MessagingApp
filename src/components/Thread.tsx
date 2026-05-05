"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  meId,
  initialMessages,
}: {
  conversationId: string;
  // Kept for API compatibility with the page that renders this component;
  // the visible top bar was removed since the conversation set is small
  // enough that "which thread am I in" is obvious.
  headerTitle?: string;
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

  // Stable id-set ref read from inside the realtime handler. Using state
  // here would force the channel to resubscribe on every new message,
  // so we mirror the latest ids into a ref instead.
  const messageIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  useEffect(() => {
    messageIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  const upsertMessage = useCallback((m: MessageWithAttachments) => {
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) {
        return [...prev, m].sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));
      }
      const next = prev.slice();
      next[idx] = { ...prev[idx], ...m };
      return next;
    });
  }, []);

  // Replace an optimistic message (matched by its temporary id) with the
  // confirmed row from the DB. Falls back to upsert if the optimistic
  // entry isn't there (e.g. realtime delivered the real one first).
  const replaceMessage = useCallback(
    (oldId: string, real: MessageWithAttachments) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === oldId);
        if (idx === -1) {
          if (prev.some((m) => m.id === real.id)) return prev;
          return [...prev, real].sort((a, b) =>
            a.sent_at < b.sent_at ? -1 : 1
          );
        }
        const next = prev.slice();
        next[idx] = real;
        return next;
      });
    },
    []
  );

  // Drop an optimistic message that failed to land.
  const removeOptimistic = useCallback((optimisticId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
  }, []);

  // Functional patch on a confirmed message — used during attachment uploads
  // to swap the placeholder attachment for the persisted row.
  const updateMessage = useCallback(
    (
      id: string,
      updater: (m: MessageWithAttachments) => MessageWithAttachments
    ) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? updater(m) : m))
      );
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

  // Realtime: messages + attachments scoped to this conversation. Subscribes
  // once on mount; reads stable refs/callbacks so it never re-subscribes
  // mid-thread.
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
          // Our own sends are added optimistically and confirmed via the
          // insert response — ignore the realtime echo.
          if (row.sender_id === meId) return;
          if (messageIdsRef.current.has(row.id)) return;
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
    meId,
    upsertMessage,
    upsertAttachment,
    removeMessage,
  ]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col pt-[env(safe-area-inset-top)]">
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
          onReplaceMessage={replaceMessage}
          onRemoveOptimistic={removeOptimistic}
          onUpdateMessage={updateMessage}
          onOpenSearch={() => setDrawerTab(drawerTab === "search" ? "closed" : "search")}
        />
      </div>

      {drawerTab !== "closed" ? (
        <>
          {/* Tap-out backdrop on mobile */}
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setDrawerTab("closed")}
            className="absolute inset-0 z-10 bg-black/30 md:hidden"
          />
          <div className="absolute inset-y-0 right-0 z-20 w-[min(20rem,100vw)] md:relative md:w-80">
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
          </div>
        </>
      ) : null}
    </div>
  );
}

export { kindFromMime };
