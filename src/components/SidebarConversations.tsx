"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatListTime } from "@/lib/format";

export interface SidebarItem {
  id: string;
  title: string;
  avatar_url: string | null;
  last_message_at: string;
  isTelegram: boolean;
}

export function SidebarConversations({
  conversations,
}: {
  conversations: SidebarItem[];
}) {
  const params = useParams();
  const activeId = (params?.id as string) || null;

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-zinc-500">
        <p>No conversations yet.</p>
        <Link
          href="/new"
          className="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Start one
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {conversations.map((c) => {
        const isActive = c.id === activeId;
        return (
          <li key={c.id}>
            <Link
              href={`/c/${c.id}`}
              className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                isActive
                  ? "bg-white dark:bg-zinc-900"
                  : "hover:bg-white/60 dark:hover:bg-zinc-900/40"
              }`}
            >
              <Avatar url={c.avatar_url} fallback={c.title} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">
                    {formatListTime(c.last_message_at)}
                  </span>
                </div>
                {c.isTelegram ? (
                  <span className="text-[10px] uppercase tracking-wide text-sky-500">
                    Telegram
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Avatar({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}) {
  const initial = (fallback || "?").trim().charAt(0).toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {initial}
    </div>
  );
}
