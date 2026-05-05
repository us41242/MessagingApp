"use client";

import Link from "next/link";
import { formatListTime } from "@/lib/format";
import type { ConversationListItem } from "@/lib/conversations";

export function MobileHomeList({
  conversations,
  email,
}: {
  conversations: ConversationListItem[];
  email: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-base font-semibold tracking-tight">Messages</h1>
        <Link
          href="/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          New
        </Link>
      </header>

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500">
          <p>No conversations yet.</p>
          <Link
            href="/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Start one
          </Link>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto bg-white dark:divide-zinc-900 dark:bg-zinc-950">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/c/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 active:bg-zinc-100 dark:active:bg-zinc-900"
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
          ))}
        </ul>
      )}

      <footer className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span className="truncate">{email}</span>
          <form action="/auth/signout" method="post">
            <button className="rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Sign out
            </button>
          </form>
        </div>
      </footer>
    </div>
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
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {initial}
    </div>
  );
}
