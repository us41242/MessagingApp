"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { kindFromMime } from "@/lib/media";
import type {
  Attachment,
  AttachmentKind,
  MessageWithAttachments,
} from "@/lib/supabase/types";
import { humanFileSize } from "@/lib/format";

interface PendingFile {
  file: File;
  kind: AttachmentKind;
  previewUrl: string | null;
}

export function Composer({
  conversationId,
  meId,
  onOptimisticInsert,
}: {
  conversationId: string;
  meId: string;
  onOptimisticInsert: (m: MessageWithAttachments) => void;
}) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: PendingFile[] = [];
    for (const f of Array.from(files)) {
      const kind = kindFromMime(f.type);
      const previewUrl =
        kind === "image" || kind === "animation" || kind === "video"
          ? URL.createObjectURL(f)
          : null;
      next.push({ file: f, kind, previewUrl });
    }
    setPending((prev) => [...prev, ...next]);
  }

  function removePending(idx: number) {
    setPending((prev) => {
      const f = prev[idx];
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function shareLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation not available in this browser.");
      return;
    }
    setBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      );
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const label = text.trim() || "Shared location";
      await sendMessage({
        body: text.trim() || null,
        location: { lat, lng, label },
        files: [],
      });
      setText("");
    } catch (e) {
      const err = e as GeolocationPositionError | Error;
      alert(
        "msg" in err && typeof (err as { message?: string }).message === "string"
          ? (err as { message: string }).message
          : "Failed to read location"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    const body = text.trim() || null;
    if (!body && pending.length === 0) return;
    setBusy(true);
    try {
      await sendMessage({ body, files: pending, location: null });
      setText("");
      setPending((prev) => {
        prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        return [];
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage({
    body,
    files,
    location,
  }: {
    body: string | null;
    files: PendingFile[];
    location: { lat: number; lng: number; label: string } | null;
  }) {
    const optimisticId = crypto.randomUUID();
    const sentAt = new Date().toISOString();

    const optimisticAttachments: Attachment[] = files.map((f) => ({
      id: crypto.randomUUID(),
      message_id: optimisticId,
      kind: f.kind,
      storage_path: null,
      external_file_id: null,
      mime_type: f.file.type || null,
      size_bytes: f.file.size,
      width: null,
      height: null,
      duration_ms: null,
      thumbnail_path: null,
      file_name: f.file.name,
      metadata: { _optimistic: true, _previewUrl: f.previewUrl },
      created_at: sentAt,
    }));

    onOptimisticInsert({
      id: optimisticId,
      conversation_id: conversationId,
      sender_id: meId,
      body,
      source: "native",
      external_id: null,
      reply_to_id: null,
      reply_to_external_id: null,
      edited_at: null,
      previous_versions: [],
      deleted_at: null,
      location_label: location?.label ?? null,
      location_lng: location?.lng ?? null,
      location_lat: location?.lat ?? null,
      sent_at: sentAt,
      created_at: sentAt,
      attachments: optimisticAttachments,
      sender: null,
    });

    // Insert message row first to get the real id.
    const { data: inserted, error: insertErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: meId,
        body,
        source: "native",
        location_lat: location?.lat ?? null,
        location_lng: location?.lng ?? null,
        location_label: location?.label ?? null,
      })
      .select(
        `id, conversation_id, sender_id, body, source, external_id,
         reply_to_id, reply_to_external_id, edited_at, previous_versions,
         deleted_at, location_label, location_lng, location_lat, sent_at, created_at,
         sender:profiles!sender_id ( id, display_name, avatar_url )`
      )
      .single();

    if (insertErr || !inserted) {
      alert(insertErr?.message || "Failed to send");
      return;
    }

    // Replace optimistic id with real one.
    const realId = inserted.id;
    onOptimisticInsert({
      ...(inserted as unknown as MessageWithAttachments),
      attachments: optimisticAttachments.map((a) => ({
        ...a,
        message_id: realId,
      })),
    });

    // Upload each file, then insert attachment rows.
    for (const f of files) {
      const ext = f.file.name.includes(".")
        ? f.file.name.slice(f.file.name.lastIndexOf("."))
        : "";
      const path = `${conversationId}/${realId}/${crypto.randomUUID()}${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, f.file, {
          contentType: f.file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) {
        alert(`Upload failed: ${upErr.message}`);
        continue;
      }

      const dims = await readDimensions(f);

      const { data: attRow } = await supabase
        .from("attachments")
        .insert({
          message_id: realId,
          kind: f.kind,
          storage_path: path,
          mime_type: f.file.type || null,
          size_bytes: f.file.size,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          duration_ms: dims?.duration ?? null,
          file_name: f.file.name,
        })
        .select("*")
        .single();
      if (attRow) {
        // Realtime will also fire, but locally upsert immediately too.
        onOptimisticInsert({
          ...(inserted as unknown as MessageWithAttachments),
          attachments: [
            ...(optimisticAttachments
              .map((a) => ({ ...a, message_id: realId }))
              .filter((a) => a.file_name !== f.file.name)),
            attRow as Attachment,
          ],
        });
      }
    }
  }

  return (
    <footer className="border-t border-zinc-200 bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 md:px-4 md:py-3 dark:border-zinc-800 dark:bg-zinc-950">
      {pending.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <div
              key={i}
              className="relative rounded-md border border-zinc-200 bg-zinc-50 p-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
            >
              {p.previewUrl ? (
                p.kind === "video" ? (
                  <video
                    src={p.previewUrl}
                    className="h-16 w-24 rounded object-cover"
                    muted
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="h-16 w-16 rounded object-cover"
                  />
                )
              ) : (
                <div className="flex h-16 w-32 flex-col justify-center px-2">
                  <div className="truncate font-medium">{p.file.name}</div>
                  <div className="text-zinc-500">
                    {humanFileSize(p.file.size)}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => removePending(i)}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white shadow"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mx-auto flex max-w-3xl items-end gap-1 md:gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          title="Attach"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <PaperclipIcon />
        </button>
        <button
          type="button"
          title="Share location"
          onClick={shareLocation}
          disabled={busy}
          className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <PinIcon />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Message"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          className="max-h-40 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={busy || (!text.trim() && pending.length === 0)}
          className="flex h-10 items-center justify-center rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </footer>
  );
}

async function readDimensions(p: PendingFile): Promise<{
  width?: number;
  height?: number;
  duration?: number;
} | null> {
  if (p.kind === "image" || p.kind === "animation") {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = p.previewUrl || "";
    });
  }
  if (p.kind === "video") {
    return await new Promise((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        resolve({
          width: v.videoWidth,
          height: v.videoHeight,
          duration: Math.round((v.duration || 0) * 1000),
        });
      v.onerror = () => resolve(null);
      v.src = p.previewUrl || "";
    });
  }
  if (p.kind === "audio" || p.kind === "voice") {
    return await new Promise((resolve) => {
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.onloadedmetadata = () =>
        resolve({ duration: Math.round((a.duration || 0) * 1000) });
      a.onerror = () => resolve(null);
      a.src = URL.createObjectURL(p.file);
    });
  }
  return null;
}

function PaperclipIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 22s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
