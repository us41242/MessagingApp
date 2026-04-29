# MessagingApp

Person-to-person messenger with seamless media, edit history, location
sharing, and Telegram history import. Next.js 16 + Supabase (Auth +
Postgres + Realtime + Storage).

## Features

- 1:1 conversations with realtime delivery
- Inline media: images, video, audio, voice notes, files, animations,
  stickers
- In-browser voice recording (mic button in the composer)
- Edit messages (with history) and soft-delete your own
- Share live location (browser geolocation → OpenStreetMap pin)
- Per-conversation search and a media/files filter drawer
- New-message alerts: sound ping, page-title flash, and Web Push
  notifications (works while the browser is closed once installed as a PWA)
- Installable as a PWA (Add to Home Screen on Android/iOS)
- Telegram chat-history import (designed-in from day one — see below)

## Local setup

### 1. Install

```bash
npm install
```

### 2. Apply the database schema

The schema is destructive on purpose — it clears every app table and
re-creates everything from scratch.

1. Open the Supabase SQL Editor for the project (URL is in `.env.local`).
2. Paste the entire contents of `supabase/schema.sql`.
3. Run.

Re-running is safe; the script is idempotent.

### 3. Configure auth redirects

In Supabase → Authentication → URL Configuration, add:

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/confirm`

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>. Sign in with any email — Supabase will
email a magic link. Open it on the same machine to land back in the app.

## How auth works

- Open signup with magic-link email OTP. No password.
- A trigger (`handle_new_user`) auto-creates a `profiles` row when a new
  auth user appears.
- Middleware protects every route except `/login` and `/auth/*`.
- `/auth/confirm?token_hash=...&type=email` exchanges the OTP for a
  session cookie and redirects to the app.

## PWA + Web Push setup

Push notifications work even when the browser is closed once you:

1. **Install the app.** On Android Chrome: hit the menu → "Add to Home
   screen" / "Install app". On iOS Safari: Share → "Add to Home Screen".
   On desktop Chrome: address-bar install icon. The app then runs in its
   own window and the OS treats it like a native app.
2. **Grant notification permission.** Sign in, then in the app's footer
   click "Enable notifications" once. The service worker subscribes to
   push and stores the subscription in the `push_subscriptions` table
   (one row per device).
3. After that, every message someone sends triggers a Web Push delivered
   to your device's notification shade. Tapping the notification opens
   the conversation directly.

Required environment variables (already set in Vercel for the live deploy
— set them locally if you develop offline):

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client + server | Browser uses it to subscribe |
| `VAPID_PRIVATE_KEY` | Server only | Signs push payloads |
| `VAPID_SUBJECT` | Server only | `mailto:you@example.com` |

Generate a fresh keypair with:

```bash
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"
```

## Importing Telegram history

This app is designed so you can drop in your Telegram export *without*
schema changes. The importer:

- Keys conversations on `telegram_chat_id` (idempotent).
- Stores every message with `source='telegram'` and `external_id` =
  Telegram message id, so re-running just upserts.
- Preserves original `sent_at` and `edited_at` timestamps (real
  history, not insert time).
- Uploads all media to Supabase Storage at
  `<conversation_id>/telegram/<file_id>/<filename>`.
- Resolves Telegram replies after import by matching
  `reply_to_external_id` → `reply_to_id`.
- Creates "ghost profiles" for Telegram contacts who don't have a
  Supabase account (they show up in your conversation list with their
  Telegram name; they never appear in the new-conversation directory).

### Steps

1. **Export from Telegram Desktop** → Settings → Advanced → Export
   Telegram data → choose chats, format **JSON**, photos + videos +
   files + voice messages all checked. Save somewhere on disk.

2. **Find your Telegram numeric user id.** Open `result.json` and grep
   for `from_id` — your own messages will all have the same one. The
   numeric portion (after `user`) is what you need.

3. **Find your MessagingApp profile id.** After signing in once,
   open the Supabase SQL editor and run:

   ```sql
   select id, display_name from profiles where is_ghost = false;
   ```

4. **Get a service role key** (Supabase → Settings → API → "service
   role" — keep this secret; never commit). Run the importer:

   ```bash
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   node scripts/import-telegram.mjs \
     --export-dir /path/to/telegram-export \
     --me-telegram-id 1234567 \
     --me-profile-id <your-profile-uuid>
   ```

   Add `--dry-run` first to preview without writing. Add
   `--only-chat-id <id>` to import a single chat.

5. Refresh the app — your Telegram conversations appear in the sidebar
   tagged with a "Telegram" badge.

## Project structure

```
src/
  app/
    (app)/                 # authenticated app shell with sidebar
      layout.tsx           # sidebar + auth gate
      page.tsx             # empty state
      c/[id]/page.tsx      # conversation thread
      new/page.tsx         # pick someone to message
    auth/
      confirm/route.ts     # magic-link verification
      signout/route.ts     # POST to sign out
    login/page.tsx         # email-OTP login
  components/
    Composer.tsx           # text + attach + location + edit
    MessageList.tsx
    MessageBubble.tsx
    AttachmentView.tsx     # inline media renderer (signed URLs)
    LocationCard.tsx       # OpenStreetMap pin
    MapPreview.tsx         # Leaflet map (client-only)
    SidebarConversations.tsx
    StartConversationButton.tsx
    Thread.tsx             # realtime sub + state owner
    ThreadDrawer.tsx       # right-side: search OR media
  lib/
    format.ts              # date/size formatters
    media.ts               # MIME → kind helpers
    supabase/
      client.ts            # browser client
      server.ts            # server-component client
      middleware.ts        # session-refreshing client for proxy
      types.ts             # hand-written row types
  middleware.ts            # route guard
supabase/
  schema.sql               # destructive + idempotent schema
scripts/
  import-telegram.mjs      # JSON-export importer (service role)
```

## Schema design notes

- `messages.source` distinguishes native sends from imported ones.
- `messages.external_id` is unique per source — the importer upserts
  by `(source, external_id)`.
- `messages.previous_versions` is a JSONB array; a `before update`
  trigger snapshots the prior body on each edit.
- `messages.location_lng/lat` are plain doubles — no PostGIS dependency.
- `attachments.external_file_id` lets the importer skip re-uploads on
  re-runs.
- `media` storage bucket is private; reads are gated by the same
  `conversation_members` membership check as messages.
