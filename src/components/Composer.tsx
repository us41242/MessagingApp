"use client";

import { useEffect, useRef, useState } from "react";
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

// Return the most compatible MediaRecorder mime type the browser supports.
// Chrome/Firefox prefer webm/opus; Safari emits mp4/aac.
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return undefined;
}

function extForMime(mime: string | undefined): string {
  if (!mime) return ".webm";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg")) return ".mp3";
  return ".webm";
}

function formatRecTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function Composer({
  conversationId,
  meId,
  onOptimisticInsert,
  onReplaceMessage,
  onRemoveOptimistic,
  onUpdateMessage,
}: {
  conversationId: string;
  meId: string;
  onOptimisticInsert: (m: MessageWithAttachments) => void;
  onReplaceMessage: (oldId: string, real: MessageWithAttachments) => void;
  onRemoveOptimistic: (optimisticId: string) => void;
  onUpdateMessage: (
    id: string,
    updater: (m: MessageWithAttachments) => MessageWithAttachments
  ) => void;
}) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice-record state
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStartRef = useRef<number>(0);
  const recorderTimerRef = useRef<number | null>(null);
  const recorderCancelledRef = useRef<boolean>(false);

  // Hard cleanup: stop the mic + drop any timer if the user navigates away
  // mid-recording.
  useEffect(() => {
    return () => {
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recorderTimerRef.current != null) {
        window.clearInterval(recorderTimerRef.current);
      }
    };
  }, []);

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
        recorderStreamRef.current = null;
        if (recorderTimerRef.current != null) {
          window.clearInterval(recorderTimerRef.current);
          recorderTimerRef.current = null;
        }
        const used = recorderCancelledRef.current;
        recorderCancelledRef.current = false;
        if (used) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recorderChunksRef.current, { type });
        const ext = extForMime(type);
        const file = new File([blob], `voice-${Date.now()}${ext}`, { type });
        const previewUrl = URL.createObjectURL(file);
        setPending((prev) => [
          ...prev,
          { file, kind: "voice", previewUrl },
        ]);
      };
      recorderRef.current = recorder;
      recorderStartRef.current = Date.now();
      recorder.start();
      setRecording(true);
      setRecordingMs(0);
      recorderTimerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - recorderStartRef.current);
      }, 100);
    } catch {
      alert("Couldn't access the microphone. Check browser permissions.");
    }
  }

  function stopRecording(cancel = false) {
    if (!recording) return;
    recorderCancelledRef.current = cancel;
    setRecording(false);
    setRecordingMs(0);
    try {
      recorderRef.current?.stop();
    } catch {
      // Recorder already stopped — drop tracks manually.
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
    }
    recorderRef.current = null;
  }

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
      onRemoveOptimistic(optimisticId);
      alert(insertErr?.message || "Failed to send");
      return;
    }

    const realId = inserted.id;
    // Swap optimistic → confirmed in place (matches by optimistic id).
    onReplaceMessage(optimisticId, {
      ...(inserted as unknown as MessageWithAttachments),
      attachments: optimisticAttachments.map((a) => ({
        ...a,
        message_id: realId,
      })),
    });

    // Upload each file, then insert attachment rows. Match each persisted
    // attachment back to its placeholder by file_name so the swap is in-place.
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
        onUpdateMessage(realId, (m) => {
          // Drop the optimistic placeholder for this file (matched by name +
          // the _optimistic flag in metadata) and append the real row.
          const filtered = m.attachments.filter((a) => {
            const meta = a.metadata as { _optimistic?: boolean } | null;
            return !(meta?._optimistic && a.file_name === f.file.name);
          });
          return { ...m, attachments: [...filtered, attRow as Attachment] };
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
              {p.kind === "voice" && p.previewUrl ? (
                <div className="flex w-56 flex-col gap-1 px-1 py-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Voice
                  </div>
                  <audio src={p.previewUrl} controls className="h-9 w-full" />
                </div>
              ) : p.previewUrl ? (
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

        {recording ? (
          <div className="flex w-full items-center gap-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/30">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono tabular-nums text-red-800 dark:text-red-200">
              {formatRecTime(recordingMs)}
            </span>
            <span className="flex-1 truncate text-xs text-red-700 dark:text-red-300">
              Recording…
            </span>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="flex h-9 items-center justify-center rounded-full bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-500"
            >
              Stop
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              title="Attach"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <PaperclipIcon />
            </button>
            <button
              type="button"
              title="Share location"
              onClick={shareLocation}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <PinIcon />
            </button>
            <button
              type="button"
              title="Record voice"
              onClick={startRecording}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <MicIcon />
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
              className="flex h-10 shrink-0 items-center justify-center rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Send
            </button>
          </>
        )}
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
function MicIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}
