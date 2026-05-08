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
import { LastSeenLabel } from "@/components/LastSeenLabel";

type SupabaseClient = ReturnType<typeof createClient>;

export function Thread({
  conversationId,
  headerTitle,
  headerLastSeenIso,
  meId,
  initialMessages,
}: {
  conversationId: string;
  headerTitle?: string;
  // ISO timestamp of the *other* member's profiles.last_seen_at for 1:1
  // chats — drives the "online" / "last seen 5m ago" sub-line under the
  // title. Null/undefined hides the sub-line (group chats, unknown peer).
  headerLastSeenIso?: string | null;
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

  // Read receipts: ids of messages I sent that the other side has read.
  const [readByOthers, setReadByOthers] = useState<Set<string>>(new Set());
  // Typing presence: true while at least one other member is typing.
  const [othersTyping, setOthersTyping] = useState(false);
  const typingClearTimerRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Set of incoming message ids we've already marked read this session, so
  // we don't re-upsert on every render of the messages array.
  const markedReadRef = useRef<Set<string>>(new Set());

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
      .channel(`conv-${conversationId}`, {
        config: { broadcast: { self: false } },
      })
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
      // Read receipts: when anyone in the conversation marks one of my
      // messages read, light up ✓✓.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reads",
        },
        (payload) => {
          const r = payload.new as { message_id: string; profile_id: string };
          if (r.profile_id === meId) return;
          setReadByOthers((prev) => {
            if (prev.has(r.message_id)) return prev;
            const next = new Set(prev);
            next.add(r.message_id);
            return next;
          });
        }
      )
      // Typing presence: ephemeral broadcast, no DB write.
      .on("broadcast", { event: "typing" }, (msg) => {
        const p = msg.payload as { profileId: string; typing: boolean };
        if (!p || p.profileId === meId) return;
        if (p.typing) {
          setOthersTyping(true);
          if (typingClearTimerRef.current != null) {
            window.clearTimeout(typingClearTimerRef.current);
          }
          // Auto-clear if we stop hearing from them; the sender also sends
          // typing:false explicitly, but this is the safety net.
          typingClearTimerRef.current = window.setTimeout(() => {
            setOthersTyping(false);
          }, 4500);
        } else {
          if (typingClearTimerRef.current != null) {
            window.clearTimeout(typingClearTimerRef.current);
            typingClearTimerRef.current = null;
          }
          setOthersTyping(false);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingClearTimerRef.current != null) {
        window.clearTimeout(typingClearTimerRef.current);
        typingClearTimerRef.current = null;
      }
      channelRef.current = null;
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

  // Initial fetch: which of my messages have already been read by anyone
  // else? Runs once per conversation; realtime keeps it fresh after that.
  useEffect(() => {
    let cancelled = false;
    const ourMsgIds = initialMessages
      .filter((m) => m.sender_id === meId)
      .map((m) => m.id);
    if (ourMsgIds.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("message_reads")
        .select("message_id")
        .in("message_id", ourMsgIds)
        .neq("profile_id", meId);
      if (cancelled || !data) return;
      setReadByOthers((prev) => {
        const next = new Set(prev);
        for (const r of data) next.add(r.message_id);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId, meId, initialMessages]);

  // Mark incoming messages as read while the chat is open. Diff against a
  // local Set so we don't re-upsert the same rows on every render.
  useEffect(() => {
    const toMark = messages.filter(
      (m) =>
        m.sender_id &&
        m.sender_id !== meId &&
        !markedReadRef.current.has(m.id)
    );
    if (toMark.length === 0) return;
    for (const m of toMark) markedReadRef.current.add(m.id);
    supabase
      .from("message_reads")
      .upsert(
        toMark.map((m) => ({ message_id: m.id, profile_id: meId })),
        { onConflict: "message_id,profile_id", ignoreDuplicates: true }
      )
      .then(({ error }) => {
        if (error) console.error("mark-read failed", error);
      });
    // Touch last_read_at on our membership row so the unread-badge logic
    // (used elsewhere for the conversation list) stays accurate too.
    supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("profile_id", meId)
      .then(() => {});
  }, [supabase, conversationId, meId, messages]);

  // Throttled typing broadcaster wired into the Composer. Sends typing:true
  // immediately on the first call after idle, then suppresses for 2s; the
  // composer also issues a typing:false on send/blur so the pulse clears.
  const lastTypingSentRef = useRef<number>(0);
  const sendTyping = useCallback(
    (typing: boolean) => {
      const ch = channelRef.current;
      if (!ch) return;
      const now = Date.now();
      if (typing) {
        if (now - lastTypingSentRef.current < 2000) return;
        lastTypingSentRef.current = now;
      } else {
        lastTypingSentRef.current = 0;
      }
      ch.send({
        type: "broadcast",
        event: "typing",
        payload: { profileId: meId, typing },
      });
    },
    [meId]
  );

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col pt-[env(safe-area-inset-top)]">
        {headerTitle ? (
          <header className="sticky top-0 z-10 flex flex-col items-center justify-center border-b border-zinc-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <span className="text-sm font-semibold leading-tight">{headerTitle}</span>
            {headerLastSeenIso ? <LastSeenLabel iso={headerLastSeenIso} /> : null}
          </header>
        ) : null}
        <MessageList
          conversationId={conversationId}
          messages={messages}
          meId={meId}
          readByOthers={readByOthers}
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
          othersTyping={othersTyping}
          onTyping={sendTyping}
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
