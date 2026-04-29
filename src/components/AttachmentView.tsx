"use client";

import { useEffect, useState } from "react";
import type { Attachment } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { humanFileSize } from "@/lib/format";

const URL_TTL_SECONDS = 60 * 60; // 1 hour

const urlCache = new Map<string, { url: string; expiresAt: number }>();

async function getSignedUrl(storagePath: string): Promise<string | null> {
  const cached = urlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

  const supabase = createClient();
  const { data } = await supabase.storage
    .from("media")
    .createSignedUrl(storagePath, URL_TTL_SECONDS);
  if (!data?.signedUrl) return null;
  urlCache.set(storagePath, {
    url: data.signedUrl,
    expiresAt: Date.now() + URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

export function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!attachment.storage_path) return;
    getSignedUrl(attachment.storage_path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    if (attachment.thumbnail_path) {
      getSignedUrl(attachment.thumbnail_path).then((u) => {
        if (!cancelled) setThumb(u);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path, attachment.thumbnail_path]);

  if (!url) {
    return (
      <div className="h-24 w-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    );
  }

  switch (attachment.kind) {
    case "image":
      return (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={attachment.file_name || ""}
            className="max-h-80 max-w-sm rounded-xl object-cover"
            loading="lazy"
            style={
              attachment.width && attachment.height
                ? {
                    aspectRatio: `${attachment.width} / ${attachment.height}`,
                  }
                : undefined
            }
          />
        </a>
      );
    case "animation":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.file_name || ""}
          className="max-h-80 max-w-sm rounded-xl"
          loading="lazy"
        />
      );
    case "video":
      return (
        <video
          src={url}
          poster={thumb || undefined}
          controls
          preload="metadata"
          className="max-h-96 max-w-md rounded-xl bg-black"
        />
      );
    case "audio":
    case "voice":
      return (
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-72"
        />
      );
    case "sticker":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-32 w-32 rounded-md"
          loading="lazy"
        />
      );
    case "file":
    default:
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-sm items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <FileIcon />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {attachment.file_name || "file"}
            </div>
            <div className="text-xs text-zinc-500">
              {attachment.size_bytes
                ? humanFileSize(attachment.size_bytes)
                : attachment.mime_type || ""}
            </div>
          </div>
        </a>
      );
  }
}

function FileIcon() {
  return (
    <svg
      className="h-6 w-6 text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
