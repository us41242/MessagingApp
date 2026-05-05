"use client";

import { createClient } from "@/lib/supabase/client";
import type { Attachment, MessageWithAttachments } from "@/lib/supabase/types";

/**
 * Open the OS share sheet for a message — text + any attached files.
 * Uses navigator.share (Web Share API), which on mobile and inside the
 * Capacitor wrapper opens the native share sheet (WhatsApp, Photos,
 * Files, etc.). On desktop browsers without Web Share, falls back to
 * copying the text to clipboard.
 */
export async function shareMessage(message: MessageWithAttachments) {
  const text = (message.body ?? "").trim();
  const files = await fetchAttachmentFiles(message.attachments);

  const shareData: ShareData = {};
  if (text) shareData.text = text;
  if (files.length > 0 && navigator.canShare?.({ files })) {
    shareData.files = files;
  }
  if (!shareData.text && !shareData.files) return;

  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share(shareData);
      return;
    } catch (e) {
      // User cancelling the share sheet throws AbortError — that's normal.
      if ((e as Error).name !== "AbortError") {
        console.warn("share failed:", e);
      } else {
        return;
      }
    }
  }

  // Desktop fallback: stuff what we can into the clipboard.
  if (text && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard.");
      return;
    } catch {
      /* fall through to alert below */
    }
  }
  alert(
    "This browser can't open a share sheet. Try the save button to download attachments instead.",
  );
}

/**
 * Trigger a download of each attachment to the device. On a desktop
 * browser this saves to the Downloads folder. On Android (Chrome /
 * Capacitor WebView) it goes through the system DownloadManager and
 * lands in Downloads. On iOS Safari, the user gets a "Download" prompt
 * and the file goes to Files; PWA mode is more limited there, so we
 * also expose share for the iPhone Save-to-Photos path.
 */
export async function saveAttachments(attachments: Attachment[]) {
  const supabase = createClient();
  for (const att of attachments) {
    if (!att.storage_path) continue;
    const { data } = await supabase.storage
      .from("media")
      .createSignedUrl(att.storage_path, 60, {
        download: att.file_name || true,
      });
    if (!data?.signedUrl) continue;

    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.rel = "noopener";
    if (att.file_name) a.download = att.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Spread multiple downloads slightly so browsers don't dedupe.
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function fetchAttachmentFiles(attachments: Attachment[]): Promise<File[]> {
  if (attachments.length === 0) return [];
  const supabase = createClient();
  const out: File[] = [];

  for (const att of attachments) {
    if (!att.storage_path) continue;
    try {
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrl(att.storage_path, 60);
      if (!data?.signedUrl) continue;

      const res = await fetch(data.signedUrl);
      if (!res.ok) continue;
      const blob = await res.blob();

      const filename =
        att.file_name ||
        `attachment-${att.id.slice(0, 6)}${guessExt(att.mime_type)}`;
      out.push(
        new File([blob], filename, {
          type: att.mime_type || blob.type || "application/octet-stream",
        }),
      );
    } catch (e) {
      console.warn("Failed to fetch attachment for share:", att.id, e);
    }
  }
  return out;
}

function guessExt(mime: string | null): string {
  if (!mime) return "";
  const known: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "application/pdf": ".pdf",
  };
  return known[mime] || "";
}
