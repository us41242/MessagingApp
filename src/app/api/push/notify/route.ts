import { type NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:noreply@example.com";

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
}

interface PushTarget {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SenderProfile {
  display_name: string | null;
}

interface AttachmentRow {
  kind: string;
}

interface MessageWithSender {
  id: string;
  conversation_id: string;
  body: string | null;
  sender_id: string | null;
  attachments: AttachmentRow[] | null;
  sender: SenderProfile | SenderProfile[] | null;
}

function attachmentSummary(att: AttachmentRow[] | null | undefined): string | null {
  if (!att || att.length === 0) return null;
  const kinds = new Set(att.map((a) => a.kind));
  if (kinds.has("image")) return att.length > 1 ? "Sent photos" : "Sent a photo";
  if (kinds.has("video")) return "Sent a video";
  if (kinds.has("voice")) return "Sent a voice message";
  if (kinds.has("audio")) return "Sent audio";
  if (kinds.has("animation")) return "Sent a GIF";
  return att.length > 1 ? "Sent attachments" : "Sent an attachment";
}

export async function POST(request: NextRequest) {
  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json(
      { error: "VAPID keys not configured" },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { messageId?: string }
    | null;
  if (!body?.messageId) {
    return NextResponse.json({ error: "missing messageId" }, { status: 400 });
  }

  const { data: msgRow } = await supabase
    .from("messages")
    .select(
      `id, conversation_id, body, sender_id,
       attachments ( kind ),
       sender:profiles!sender_id ( display_name )`
    )
    .eq("id", body.messageId)
    .maybeSingle();
  const msg = msgRow as MessageWithSender | null;
  if (!msg) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const { data: targetsData, error: targetsErr } = await supabase.rpc(
    "get_push_targets_for_message",
    { msg_id: body.messageId }
  );
  if (targetsErr) {
    return NextResponse.json({ error: targetsErr.message }, { status: 500 });
  }
  const targets = (targetsData ?? []) as PushTarget[];

  const senderProfile = Array.isArray(msg.sender)
    ? msg.sender[0]
    : msg.sender;
  const title = senderProfile?.display_name || "New message";
  const preview =
    (msg.body && msg.body.trim().length > 0 ? msg.body : null) ??
    attachmentSummary(msg.attachments) ??
    "Sent a message";

  const payload = JSON.stringify({
    title,
    body: preview.length > 140 ? `${preview.slice(0, 137)}…` : preview,
    url: `/c/${msg.conversation_id}`,
    tag: msg.conversation_id,
  });

  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification(
        {
          endpoint: t.endpoint,
          keys: { p256dh: t.p256dh, auth: t.auth },
        },
        payload,
        { TTL: 3600 }
      )
    )
  );

  let sent = 0;
  let stale: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent += 1;
    } else {
      const err = r.reason as { statusCode?: number };
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        stale.push(targets[i].endpoint);
      }
    }
  });

  // Best-effort cleanup. RLS only lets a user delete their own rows, so this
  // covers the common case where a user's own subscription rotated; cross-user
  // stale rows linger but cause no harm beyond a single failed push attempt.
  if (stale.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", stale);
  }

  return NextResponse.json({
    sent,
    total: targets.length,
    stale: stale.length,
  });
}
