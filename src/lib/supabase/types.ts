// Hand-written types mirroring supabase/schema.sql. Once the import
// script lands we'll regenerate via `supabase gen types`, but for now
// these keep the app strictly typed without a CLI dependency.

export type MessageSource = "native" | "telegram";

export type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "file"
  | "sticker"
  | "animation"
  | "location";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_ghost: boolean;
  telegram_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  telegram_chat_id: number | null;
  title: string | null;
  created_at: string;
  last_message_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  profile_id: string;
  joined_at: string;
  last_read_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string | null;
  source: MessageSource;
  external_id: string | null;
  reply_to_id: string | null;
  reply_to_external_id: string | null;
  edited_at: string | null;
  previous_versions: Array<{ body: string | null; edited_at: string }>;
  deleted_at: string | null;
  // location is geography; Supabase returns it as a string unless we
  // request lng/lat explicitly. We stash lng/lat alongside instead.
  location_label: string | null;
  location_lng: number | null;
  location_lat: number | null;
  sent_at: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  storage_path: string | null;
  external_file_id: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumbnail_path: string | null;
  file_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MessageWithAttachments extends MessageRow {
  attachments: Attachment[];
  sender: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}
