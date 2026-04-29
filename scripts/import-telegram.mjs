#!/usr/bin/env node
// ============================================================================
// Telegram chat-history → MessagingApp Supabase importer.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/import-telegram.mjs \
//     --export-dir ./telegram-export \
//     --me-telegram-id 12345 \
//     --me-profile-id <uuid-of-your-real-profile>
//
// What it does:
//   1. Reads `result.json` from the export dir (Telegram Desktop "Export
//      chat history" → JSON option). Supports both single-chat exports and
//      whole-account exports (`chats.list`).
//   2. For each chat:
//      a. Upserts a `conversations` row keyed by telegram_chat_id.
//      b. Maps Telegram user ids → MessagingApp profiles. Your own
//         telegram id is bound to your real profile (--me-*). Everyone
//         else gets a ghost profile created on first sight.
//      c. Iterates messages: skips service messages; uploads media to
//         the `media` bucket at path
//         `<conversation_id>/telegram/<external_file_id>`; upserts
//         message rows keyed by (source='telegram', external_id).
//      d. After all messages land, resolves reply_to_external_id →
//         reply_to_id with a single SQL update.
//
// Idempotent: re-runs will only insert what's missing.
//
// Why a separate script: bulk insert + storage upload needs the service
// role key and runs much faster outside the browser.
// ============================================================================

import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// --------- arg parsing -----------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const exportDir = resolve(args["export-dir"] || "./telegram-export");
const meTelegramId = args["me-telegram-id"]
  ? Number(args["me-telegram-id"])
  : null;
const meProfileId = args["me-profile-id"] || null;
const dryRun = !!args["dry-run"];
const onlyChat = args["only-chat-id"] ? Number(args["only-chat-id"]) : null;

if (!meTelegramId || !meProfileId) {
  fail(
    "Required: --me-telegram-id <int> and --me-profile-id <uuid>.\n" +
      "Find your Telegram numeric user id by exporting and searching for\n" +
      "your own from_id in result.json. Find your profile id with:\n" +
      "  select id from profiles where id = auth.uid();"
  );
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL not set in env.");
if (!SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY not set in env.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --------- main -----------------------------------------------------------
const resultPath = join(exportDir, "result.json");
console.log(`📂 Reading ${resultPath}`);
const root = JSON.parse(await readFile(resultPath, "utf8"));

const chats = root.chats?.list ?? [root]; // whole-account vs single-chat
const filtered = onlyChat
  ? chats.filter((c) => Number(c.id) === onlyChat)
  : chats.filter((c) => c.type === "personal_chat");

console.log(`💬 Found ${filtered.length} personal chat(s) to import.`);

// Cache: telegram_user_id → profile_id (for senders across all chats)
const profileByTgId = new Map();
profileByTgId.set(meTelegramId, meProfileId);

for (const chat of filtered) {
  await importChat(chat);
}

console.log("\n✅ Done.");

// --------- functions ------------------------------------------------------

async function importChat(chat) {
  const tgChatId = Number(chat.id);
  console.log(`\n— ${chat.name || "(untitled)"}  (telegram id: ${tgChatId})`);
  console.log(`   ${chat.messages.length} message(s)`);

  // 1. conversation
  const conversation = await upsertConversation(tgChatId, chat.name || null);
  console.log(`   conversation: ${conversation.id}`);

  // 2. determine the "other" telegram user id from the messages
  const otherTgId = inferOtherTelegramId(chat.messages, meTelegramId);
  if (otherTgId == null) {
    console.warn(
      "   ⚠️ Could not infer the other party's Telegram id; skipping chat."
    );
    return;
  }
  const otherProfileId = await ensureProfileForTelegramId(
    otherTgId,
    chat.name || `Telegram ${otherTgId}`
  );

  // 3. ensure both profiles are members of the conversation
  await ensureMember(conversation.id, meProfileId);
  await ensureMember(conversation.id, otherProfileId);

  // 4. iterate messages
  let inserted = 0;
  let skipped = 0;
  for (const m of chat.messages) {
    if (m.type !== "message") {
      skipped++;
      continue;
    }
    const senderTgId = parseFromId(m.from_id);
    const senderProfile = senderTgId
      ? await ensureProfileForTelegramId(
          senderTgId,
          m.from || `Telegram ${senderTgId}`
        )
      : null;

    const externalId = String(m.id);
    const sentAt = isoFrom(m.date_unixtime || m.date);
    const editedAt = m.edited_unixtime || m.edited
      ? isoFrom(m.edited_unixtime || m.edited)
      : null;

    const body = collectText(m);
    const replyToExternalId =
      m.reply_to_message_id != null ? String(m.reply_to_message_id) : null;

    let location_lat = null;
    let location_lng = null;
    let location_label = null;
    if (m.location_information) {
      location_lat = m.location_information.latitude;
      location_lng = m.location_information.longitude;
      location_label = m.place_name || m.address || "Shared location";
    }

    if (dryRun) {
      console.log(`   [dry] ${externalId}: ${body?.slice(0, 50) || "(media)"}`);
      continue;
    }

    // upsert message keyed by (source, external_id)
    const { data: msgRow, error: msgErr } = await supabase
      .from("messages")
      .upsert(
        {
          conversation_id: conversation.id,
          sender_id: senderProfile,
          body: body || null,
          source: "telegram",
          external_id: externalId,
          reply_to_external_id: replyToExternalId,
          edited_at: editedAt,
          location_lat,
          location_lng,
          location_label,
          sent_at: sentAt,
        },
        { onConflict: "source,external_id" }
      )
      .select("id")
      .single();
    if (msgErr) {
      console.error(`   ⚠️ message ${externalId}:`, msgErr.message);
      continue;
    }
    inserted++;

    // attachments: photo / file / video_file / voice_message / sticker / animation
    const attachments = collectAttachments(m);
    for (const att of attachments) {
      await uploadAttachment(conversation.id, msgRow.id, exportDir, att);
    }
  }

  // 5. resolve reply_to_external_id → reply_to_id for this conversation
  if (!dryRun) {
    const { error } = await supabase.rpc("exec_sql_unsafe_unused", {});
    // PostgREST can't run arbitrary SQL; do it in two steps via the
    // table API instead (one update per parent message — small enough).
    void error;
    await resolveRepliesViaApi(conversation.id);
  }

  console.log(`   inserted: ${inserted}, skipped: ${skipped}`);
}

async function resolveRepliesViaApi(conversationId) {
  // Pull all messages in this conversation that have an unresolved reply.
  const { data: pending } = await supabase
    .from("messages")
    .select("id, reply_to_external_id")
    .eq("conversation_id", conversationId)
    .not("reply_to_external_id", "is", null)
    .is("reply_to_id", null);
  if (!pending || pending.length === 0) return;

  // Build a map external_id → id for parents we need.
  const parentExternalIds = [...new Set(pending.map((p) => p.reply_to_external_id))];
  const { data: parents } = await supabase
    .from("messages")
    .select("id, external_id")
    .eq("conversation_id", conversationId)
    .in("external_id", parentExternalIds);
  const parentMap = new Map();
  for (const p of parents || []) parentMap.set(p.external_id, p.id);

  for (const p of pending) {
    const parentId = parentMap.get(p.reply_to_external_id);
    if (!parentId) continue;
    await supabase
      .from("messages")
      .update({ reply_to_id: parentId })
      .eq("id", p.id);
  }
}

async function uploadAttachment(conversationId, messageId, baseDir, att) {
  const relPath = att.relPath;
  const absPath = join(baseDir, relPath);
  const fileExternalId = att.externalFileId || hashPath(relPath);

  // skip if already imported (idempotent)
  const { data: existing } = await supabase
    .from("attachments")
    .select("id")
    .eq("message_id", messageId)
    .eq("external_file_id", fileExternalId)
    .maybeSingle();
  if (existing) return;

  let size = null;
  try {
    size = (await stat(absPath)).size;
  } catch {
    console.warn(`   ⚠️ missing file: ${absPath}`);
    return;
  }

  const storagePath = `${conversationId}/telegram/${fileExternalId}/${basename(
    relPath
  )}`;
  const buf = await readFile(absPath);
  const { error: upErr } = await supabase.storage
    .from("media")
    .upload(storagePath, buf, {
      contentType: att.mime || guessMime(relPath),
      upsert: true,
    });
  if (upErr) {
    console.warn(`   ⚠️ upload ${relPath}:`, upErr.message);
    return;
  }

  let thumbPath = null;
  if (att.thumbnailRelPath) {
    const thumbAbs = join(baseDir, att.thumbnailRelPath);
    try {
      const thumbBuf = await readFile(thumbAbs);
      thumbPath = `${conversationId}/telegram/${fileExternalId}/_thumb_${basename(
        att.thumbnailRelPath
      )}`;
      await supabase.storage.from("media").upload(thumbPath, thumbBuf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    } catch {
      // thumbnail missing — fine
    }
  }

  await supabase.from("attachments").insert({
    message_id: messageId,
    kind: att.kind,
    storage_path: storagePath,
    thumbnail_path: thumbPath,
    external_file_id: fileExternalId,
    mime_type: att.mime || guessMime(relPath),
    size_bytes: size,
    width: att.width ?? null,
    height: att.height ?? null,
    duration_ms: att.durationMs ?? null,
    file_name: basename(relPath),
  });
}

function collectAttachments(m) {
  const out = [];
  if (m.photo) {
    out.push({
      kind: "image",
      relPath: m.photo,
      width: m.width,
      height: m.height,
      externalFileId: m.photo, // path is unique enough
    });
  }
  if (m.file) {
    const mediaType = m.media_type;
    let kind = "file";
    if (mediaType === "voice_message") kind = "voice";
    else if (mediaType === "audio_file") kind = "audio";
    else if (mediaType === "video_file") kind = "video";
    else if (mediaType === "video_message") kind = "video";
    else if (mediaType === "sticker") kind = "sticker";
    else if (mediaType === "animation") kind = "animation";
    out.push({
      kind,
      relPath: m.file,
      thumbnailRelPath: m.thumbnail || null,
      width: m.width,
      height: m.height,
      durationMs: m.duration_seconds ? m.duration_seconds * 1000 : null,
      mime: m.mime_type,
      externalFileId: m.file,
    });
  }
  if (m.contact_information || m.poll || m.contact_vcard) {
    // Not handled in MVP; metadata-only stub
  }
  return out;
}

function collectText(m) {
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.text_entities)) {
    return m.text_entities.map((e) => e.text).join("");
  }
  if (Array.isArray(m.text)) {
    return m.text
      .map((e) => (typeof e === "string" ? e : e.text || ""))
      .join("");
  }
  return null;
}

function inferOtherTelegramId(messages, me) {
  for (const m of messages) {
    const id = parseFromId(m.from_id);
    if (id != null && id !== me) return id;
  }
  return null;
}

function parseFromId(fromId) {
  if (!fromId) return null;
  // Telegram "user1234567" or "channel123" -> 1234567
  const match = String(fromId).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

async function upsertConversation(tgChatId, title) {
  const { data: found } = await supabase
    .from("conversations")
    .select("id")
    .eq("telegram_chat_id", tgChatId)
    .maybeSingle();
  if (found) return found;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ telegram_chat_id: tgChatId, title })
    .select("id")
    .single();
  if (error) fail(`Failed to create conversation: ${error.message}`);
  return data;
}

async function ensureMember(conversationId, profileId) {
  const { error } = await supabase
    .from("conversation_members")
    .upsert(
      { conversation_id: conversationId, profile_id: profileId },
      { onConflict: "conversation_id,profile_id" }
    );
  if (error) console.warn(`   ⚠️ ensureMember:`, error.message);
}

async function ensureProfileForTelegramId(telegramId, displayName) {
  if (profileByTgId.has(telegramId)) return profileByTgId.get(telegramId);

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (existing) {
    profileByTgId.set(telegramId, existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      display_name: displayName,
      telegram_id: telegramId,
      is_ghost: true,
    })
    .select("id")
    .single();
  if (error) fail(`Could not create ghost profile: ${error.message}`);
  profileByTgId.set(telegramId, data.id);
  return data.id;
}

function isoFrom(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    return new Date(Number(value) * 1000).toISOString();
  }
  // "2023-01-01T12:34:56" — local-time, naive. Treat as UTC.
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

function hashPath(p) {
  return createHash("sha1").update(p).digest("hex").slice(0, 16);
}

function guessMime(relPath) {
  const ext = relPath.toLowerCase().split(".").pop();
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    pdf: "application/pdf",
    txt: "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// quiet down unused-Buffer warning
void Buffer;
void createReadStream;
