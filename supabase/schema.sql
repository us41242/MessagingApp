-- ============================================================================
-- MessagingApp — Schema
-- ============================================================================
-- Run this entire file in the Supabase SQL Editor. It is destructive: it
-- drops every app table and storage bucket policy first, then recreates
-- everything from scratch. Idempotent — safe to re-run.
--
-- Designed so that the Telegram import script can upsert historical
-- messages with their original timestamps, message ids, and edit history
-- without any schema changes.
-- ============================================================================

-- --------- 1. CLEAR -------------------------------------------------------
drop table if exists public.message_reads cascade;
drop table if exists public.attachments cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversation_members cascade;
drop table if exists public.conversations cascade;
drop table if exists public.profiles cascade;
drop type if exists public.message_source cascade;
drop type if exists public.attachment_kind cascade;

-- --------- 2. EXTENSIONS --------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- --------- 3. ENUMS -------------------------------------------------------
create type public.message_source as enum ('native', 'telegram');
create type public.attachment_kind as enum (
  'image', 'video', 'audio', 'voice', 'file', 'sticker', 'animation', 'location'
);

-- --------- 4. TABLES ------------------------------------------------------

-- profiles: one row per real or "ghost" user. The FK to auth.users is
-- intentionally omitted: the new-user trigger creates a profile with id =
-- auth.users.id for real signups, and the Telegram importer creates ghost
-- profiles (no auth account, only display name + telegram_id) for chats
-- with people who haven't signed up. is_ghost lets the UI hide ghosts
-- from the directory and labels them clearly.
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  username      text unique,
  display_name  text,
  avatar_url    text,
  is_ghost      boolean not null default false,
  -- maps a Telegram user id to this profile so imports attach correctly
  telegram_id   bigint unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- conversations: 1:1 thread between two users (group support deferred)
create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  -- For Telegram-imported chats, the original chat id (lets the importer
  -- be idempotent and lets us merge an imported chat with its native
  -- counterpart later).
  telegram_chat_id  bigint unique,
  title         text,        -- nullable; UI falls back to other member's name
  created_at    timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- conversation_members: who's in each conversation
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  joined_at      timestamptz not null default now(),
  last_read_at   timestamptz,
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile_idx on public.conversation_members(profile_id);

-- messages: the canonical message table
-- Notes for the Telegram importer:
--   * `source`             = 'telegram'
--   * `external_id`        = Telegram message id (string for safety)
--   * `sent_at`            = original Telegram timestamp (NOT insert time)
--   * `edited_at`          = Telegram edit timestamp if present
--   * `previous_versions`  = jsonb array of {body, edited_at} prior states
--   * `reply_to_external_id` is resolved to `reply_to_id` after import
create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id     uuid references public.profiles(id) on delete set null,
  body          text,
  source        public.message_source not null default 'native',
  external_id   text,
  reply_to_id   uuid references public.messages(id) on delete set null,
  reply_to_external_id text,           -- staging field for importer
  edited_at     timestamptz,
  previous_versions jsonb not null default '[]'::jsonb,
  deleted_at    timestamptz,
  -- location messages: stored alongside body so a single message can be
  -- "I'm here" + a pin. Plain lng/lat in WGS84 — no PostGIS dependency.
  location_lng  double precision,
  location_lat  double precision,
  location_label text,
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- guard against duplicate Telegram messages on re-import
  unique (source, external_id)
);
create index messages_conversation_sent_idx on public.messages(conversation_id, sent_at desc);
create index messages_sender_idx on public.messages(sender_id);
-- trigram index for fast in-conversation full-text search
create index messages_body_trgm_idx on public.messages using gin (body gin_trgm_ops);

-- attachments: 0..N per message; keyed by external file id for idempotent re-import
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  kind          public.attachment_kind not null,
  -- Storage path within the 'media' bucket. For Telegram imports staged
  -- locally, this is set after upload completes.
  storage_path  text,
  -- Original Telegram file id; lets the importer skip re-uploading.
  external_file_id text,
  mime_type     text,
  size_bytes    bigint,
  width         int,
  height        int,
  duration_ms   int,
  -- Telegram thumbnail (data url or small jpeg) — optional, not required
  thumbnail_path text,
  -- Original filename, useful for the "files" view in the media drawer
  file_name     text,
  -- Caption travels on the message body; this is metadata-only
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (message_id, external_file_id)
);
create index attachments_message_idx on public.attachments(message_id);
create index attachments_kind_idx on public.attachments(kind);

-- message_reads: per-recipient read receipts
create table public.message_reads (
  message_id    uuid not null references public.messages(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  read_at       timestamptz not null default now(),
  primary key (message_id, profile_id)
);

-- --------- 5. TRIGGERS ----------------------------------------------------

-- Touch conversations.last_message_at when a message lands (real or imported).
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update public.conversations
     set last_message_at = greatest(last_message_at, new.sent_at)
   where id = new.conversation_id;
  return new;
end;
$$;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();

-- When a profile edits a message, snapshot the prior body into
-- previous_versions so the UI can show edit history.
create or replace function public.snapshot_message_edit()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then
    new.previous_versions := old.previous_versions ||
      jsonb_build_object(
        'body', old.body,
        'edited_at', coalesce(old.edited_at, old.sent_at)
      );
    new.edited_at := now();
  end if;
  return new;
end;
$$;
create trigger messages_snapshot_edit
  before update on public.messages
  for each row
  when (old.body is distinct from new.body)
  execute function public.snapshot_message_edit();

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------- 6. RPC: get-or-create 1:1 conversation -------------------------
create or replace function public.get_or_create_dm(other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if me = other_profile_id then raise exception 'cannot DM self'; end if;

  -- Find a conversation that has exactly these two members.
  select c.id into conv_id
  from public.conversations c
  where (
    select count(*) from public.conversation_members m
    where m.conversation_id = c.id
  ) = 2
    and exists (select 1 from public.conversation_members where conversation_id = c.id and profile_id = me)
    and exists (select 1 from public.conversation_members where conversation_id = c.id and profile_id = other_profile_id)
    and c.telegram_chat_id is null
  limit 1;

  if conv_id is not null then return conv_id; end if;

  insert into public.conversations default values returning id into conv_id;
  insert into public.conversation_members (conversation_id, profile_id) values (conv_id, me);
  insert into public.conversation_members (conversation_id, profile_id) values (conv_id, other_profile_id);
  return conv_id;
end;
$$;

-- --------- 7. RLS ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.message_reads enable row level security;

-- profiles: any authenticated user can see profiles (it's a 1:1 messenger
-- with open signup; everyone can find each other). Users can edit their own.
create policy "profiles read" on public.profiles
  for select to authenticated using (true);
create policy "profiles update self" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- conversations: members only
create policy "conversations read" on public.conversations
  for select to authenticated using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversations.id and m.profile_id = auth.uid()
    )
  );
create policy "conversations insert any auth" on public.conversations
  for insert to authenticated with check (true);
create policy "conversations update member" on public.conversations
  for update to authenticated using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversations.id and m.profile_id = auth.uid()
    )
  );

-- members: a user sees membership rows for conversations they're in
create policy "members read" on public.conversation_members
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversation_members.conversation_id and m.profile_id = auth.uid()
    )
  );
create policy "members insert self" on public.conversation_members
  for insert to authenticated with check (profile_id = auth.uid());
create policy "members update self" on public.conversation_members
  for update to authenticated using (profile_id = auth.uid());

-- messages: read if member of the conversation, write as self
create policy "messages read" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = messages.conversation_id and m.profile_id = auth.uid()
    )
  );
create policy "messages insert self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = messages.conversation_id and m.profile_id = auth.uid()
    )
  );
create policy "messages update own" on public.messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy "messages delete own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- attachments: gated through the parent message
create policy "attachments read" on public.attachments
  for select to authenticated using (
    exists (
      select 1 from public.messages msg
      join public.conversation_members m on m.conversation_id = msg.conversation_id
      where msg.id = attachments.message_id and m.profile_id = auth.uid()
    )
  );
create policy "attachments insert via own message" on public.attachments
  for insert to authenticated with check (
    exists (
      select 1 from public.messages msg
      where msg.id = attachments.message_id and msg.sender_id = auth.uid()
    )
  );
create policy "attachments delete via own message" on public.attachments
  for delete to authenticated using (
    exists (
      select 1 from public.messages msg
      where msg.id = attachments.message_id and msg.sender_id = auth.uid()
    )
  );

-- reads: a user can mark their own reads
create policy "reads read" on public.message_reads
  for select to authenticated using (
    profile_id = auth.uid() or exists (
      select 1 from public.messages msg
      where msg.id = message_reads.message_id and msg.sender_id = auth.uid()
    )
  );
create policy "reads write self" on public.message_reads
  for insert to authenticated with check (profile_id = auth.uid());

-- --------- 8. STORAGE -----------------------------------------------------
-- Single 'media' bucket; files are namespaced by conversation_id/message_id.
insert into storage.buckets (id, name, public)
  values ('media', 'media', false)
  on conflict (id) do nothing;

-- Drop existing policies if re-running
drop policy if exists "media read members" on storage.objects;
drop policy if exists "media write authed" on storage.objects;
drop policy if exists "media delete owner" on storage.objects;

-- Path convention: media/<conversation_id>/<message_id>/<filename>
create policy "media read members" on storage.objects
  for select to authenticated using (
    bucket_id = 'media'
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = (split_part(name, '/', 1))::uuid
        and m.profile_id = auth.uid()
    )
  );
create policy "media write authed" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media'
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = (split_part(name, '/', 1))::uuid
        and m.profile_id = auth.uid()
    )
  );
create policy "media delete owner" on storage.objects
  for delete to authenticated using (
    bucket_id = 'media' and owner = auth.uid()
  );

-- --------- 9. REALTIME ----------------------------------------------------
-- Enable realtime publication for messages + attachments
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.attachments;
alter publication supabase_realtime add table public.conversations;
