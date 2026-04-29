"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Attachment,
  AttachmentKind,
  MessageWithAttachments,
} from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { formatListTime, humanFileSize } from "@/lib/format";

type Tab = "search" | "media";

const MEDIA_TABS: { id: AttachmentKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "file", label: "Files" },
];

export function ThreadDrawer({
  tab,
  conversationId,
  messages,
  onClose,
  onJump,
}: {
  tab: Tab;
  conversationId: string;
  messages: MessageWithAttachments[];
  onClose: () => void;
  onJump: (messageId: string) => void;
}) {
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-zinc-200 bg-white shadow-xl md:shadow-none dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h3 className="text-sm font-semibold capitalize">{tab}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ×
        </button>
      </header>
      {tab === "search" ? (
        <SearchPanel conversationId={conversationId} onJump={onJump} />
      ) : (
        <MediaPanel messages={messages} onJump={onJump} />
      )}
    </aside>
  );
}

function SearchPanel({
  conversationId,
  onJump,
}: {
  conversationId: string;
  onJump: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; body: string | null; sent_at: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      // PostgREST `ilike` works fine here, and the trigram index in the
      // schema makes substring matches fast at scale.
      const { data } = await supabase
        .from("messages")
        .select("id, body, sent_at")
        .eq("conversation_id", conversationId)
        .ilike("body", `%${term}%`)
        .is("deleted_at", null)
        .order("sent_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setResults(data ?? []);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, conversationId, supabase]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <input
          type="search"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this conversation"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-zinc-500">Searching…</div>
        ) : results.length === 0 && q.trim().length >= 2 ? (
          <div className="p-4 text-xs text-zinc-500">No matches.</div>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onJump(r.id)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="line-clamp-2">
                    {highlight(r.body || "", q.trim())}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
                    {formatListTime(r.sent_at)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, term: string) {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800/60">
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  );
}

function MediaPanel({
  messages,
  onJump,
}: {
  messages: MessageWithAttachments[];
  onJump: (messageId: string) => void;
}) {
  const [active, setActive] = useState<AttachmentKind | "all">("all");

  const items = useMemo(() => {
    const all: Array<{ a: Attachment; messageId: string; sent_at: string }> = [];
    for (const m of messages) {
      for (const a of m.attachments) {
        all.push({ a, messageId: m.id, sent_at: m.sent_at });
      }
    }
    return all
      .filter((x) => {
        if (active === "all") return true;
        if (active === "image")
          return x.a.kind === "image" || x.a.kind === "animation";
        if (active === "audio")
          return x.a.kind === "audio" || x.a.kind === "voice";
        return x.a.kind === active;
      })
      .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  }, [messages, active]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex gap-1 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
        {MEDIA_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              active === t.id
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            Nothing here.
          </div>
        ) : active === "image" || active === "all" ? (
          <div className="grid grid-cols-3 gap-1">
            {items.map(({ a, messageId }) => (
              <MediaTile
                key={a.id}
                attachment={a}
                onClick={() => onJump(messageId)}
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map(({ a, messageId, sent_at }) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onJump(messageId)}
                  className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="text-base">{kindEmoji(a.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {a.file_name || a.kind}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                      {formatListTime(sent_at)}
                      {a.size_bytes ? ` • ${humanFileSize(a.size_bytes)}` : ""}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MediaTile({
  attachment,
  onClick,
}: {
  attachment: Attachment;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!attachment.storage_path) return;
    const supabase = createClient();
    supabase.storage
      .from("media")
      .createSignedUrl(attachment.storage_path, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  if (
    attachment.kind !== "image" &&
    attachment.kind !== "animation" &&
    attachment.kind !== "video"
  ) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex aspect-square items-center justify-center rounded bg-zinc-100 text-2xl dark:bg-zinc-800"
      >
        {kindEmoji(attachment.kind)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-full w-full animate-pulse" />
      )}
    </button>
  );
}

function kindEmoji(k: AttachmentKind): string {
  switch (k) {
    case "image":
      return "🖼️";
    case "animation":
      return "🎞️";
    case "video":
      return "🎬";
    case "audio":
      return "🎵";
    case "voice":
      return "🎙️";
    case "sticker":
      return "🩷";
    case "location":
      return "📍";
    default:
      return "📎";
  }
}
