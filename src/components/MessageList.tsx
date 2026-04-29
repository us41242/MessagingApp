"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageWithAttachments } from "@/lib/supabase/types";
import { formatDayHeader, formatMessageTime, sameDay } from "@/lib/format";
import { MessageBubble } from "@/components/MessageBubble";

export function MessageList({
  conversationId,
  messages,
  meId,
  onEdit,
  onDelete,
}: {
  conversationId: string;
  messages: MessageWithAttachments[];
  meId: string;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyToBottom = useRef(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Track whether the user is at the bottom; if so, snap on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyToBottom.current = fromBottom < 60;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickyToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // On first mount, jump to bottom unconditionally.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden bg-zinc-50 dark:bg-black"
    >
      <div className="mx-auto w-full max-w-3xl px-3 py-6 md:px-4">
        {messages.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            Say hello.
          </div>
        ) : null}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDate = !prev || !sameDay(prev.sent_at, m.sent_at);
          const samePrevSender =
            prev && prev.sender_id === m.sender_id && !showDate;
          return (
            <div key={m.id}>
              {showDate ? (
                <div className="my-4 flex justify-center">
                  <span className="rounded-full bg-zinc-200 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {formatDayHeader(m.sent_at)}
                  </span>
                </div>
              ) : null}
              <div id={`msg-${m.id}`} className="rounded-md transition-shadow">
                <MessageBubble
                  message={m}
                  meId={meId}
                  groupedWithPrev={!!samePrevSender}
                  isEditing={editingId === m.id}
                  onStartEdit={() => setEditingId(m.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSubmitEdit={async (body) => {
                    await onEdit(m.id, body);
                    setEditingId(null);
                  }}
                  onDelete={() => onDelete(m.id)}
                  formatTime={formatMessageTime}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
