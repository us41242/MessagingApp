"use client";

import { useState } from "react";
import type { MessageWithAttachments } from "@/lib/supabase/types";
import { AttachmentView } from "@/components/AttachmentView";
import { LocationCard } from "@/components/LocationCard";

export function MessageBubble({
  message,
  meId,
  groupedWithPrev,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  formatTime,
}: {
  message: MessageWithAttachments;
  meId: string;
  groupedWithPrev: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  formatTime: (iso: string) => string;
}) {
  const isMine = message.sender_id === meId;
  const [draft, setDraft] = useState(message.body ?? "");
  const [showHistory, setShowHistory] = useState(false);

  const hasLocation =
    message.location_lat != null && message.location_lng != null;

  return (
    <div
      className={`group flex ${isMine ? "justify-end" : "justify-start"} ${
        groupedWithPrev ? "mt-1" : "mt-4"
      }`}
    >
      <div
        className={`flex min-w-0 max-w-[85%] flex-col md:max-w-[75%] ${
          isMine ? "items-end" : "items-start"
        }`}
      >
        {!groupedWithPrev && !isMine ? (
          <div className="mb-1 px-1 text-xs font-medium text-zinc-500">
            {message.sender?.display_name || "—"}
          </div>
        ) : null}

        {message.attachments.length > 0 ? (
          <div
            className={`mb-1 flex flex-col gap-1 ${
              isMine ? "items-end" : "items-start"
            }`}
          >
            {message.attachments.map((a) => (
              <AttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        ) : null}

        {hasLocation ? (
          <LocationCard
            lat={message.location_lat!}
            lng={message.location_lng!}
            label={message.location_label}
          />
        ) : null}

        {message.body || isEditing ? (
          isEditing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (draft.trim()) await onSubmitEdit(draft.trim());
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(6, draft.split("\n").length + 1)}
                className="w-72 rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="flex gap-2 self-end">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
                >
                  Save
                </button>
              </div>
            </form>
          ) : (
            <div
              className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                isMine
                  ? "bg-blue-600 text-white"
                  : "bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
              }`}
            >
              {message.body}
            </div>
          )
        ) : null}

        <div
          className={`mt-1 flex items-center gap-2 px-1 text-[10px] uppercase tracking-wide text-zinc-400 ${
            isMine ? "flex-row-reverse" : ""
          }`}
        >
          <span>{formatTime(message.sent_at)}</span>
          {message.edited_at ? (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-zinc-400 hover:underline"
            >
              edited
            </button>
          ) : null}
          {message.source === "telegram" ? (
            <span className="rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              tg
            </span>
          ) : null}
          {isMine && !isEditing ? (
            <span className="hidden gap-1 group-hover:flex">
              <button
                type="button"
                onClick={onStartEdit}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="text-zinc-500 hover:text-red-600"
              >
                delete
              </button>
            </span>
          ) : null}
        </div>

        {showHistory && message.previous_versions.length > 0 ? (
          <div className="mt-1 max-w-md rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-700 dark:bg-amber-950/30">
            <div className="mb-1 font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Edit history
            </div>
            <ul className="space-y-1">
              {message.previous_versions.map((v, i) => (
                <li key={i} className="text-amber-900 dark:text-amber-200">
                  <span className="text-amber-600">
                    {new Date(v.edited_at).toLocaleString()}:{" "}
                  </span>
                  {v.body || <em>(empty)</em>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
