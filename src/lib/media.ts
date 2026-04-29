import type { AttachmentKind } from "@/lib/supabase/types";

export function kindFromMime(mime: string | null | undefined): AttachmentKind {
  if (!mime) return "file";
  if (mime.startsWith("image/")) {
    if (mime === "image/gif") return "animation";
    return "image";
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function publicMediaUrl(
  supabaseUrl: string,
  storagePath: string
): string {
  // We use signed URLs in practice via Storage API; this helper is
  // only used for the rare case where a path is already a public URL
  // (e.g. legacy Telegram media re-hosted publicly).
  if (storagePath.startsWith("http")) return storagePath;
  return `${supabaseUrl}/storage/v1/object/public/media/${storagePath}`;
}
