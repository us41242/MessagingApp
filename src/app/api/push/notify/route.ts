import { type NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { getFcmMessaging } from "@/lib/fcm";

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

interface FcmTarget {
  token_id: string;
  token: string;
  platform: string;
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
  try {
    return await handleNotify(request);
  } catch (e) {
    const err = e as Error;
    console.error("notify route threw:", err);
    return NextResponse.json(
      { error: "internal", message: err?.message, stack: err?.stack?.split("\n").slice(0, 6) },
      { status: 500 }
    );
  }
}

async function handleNotify(request: NextRequest) {
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

  const [webResult, fcmResult] = await Promise.all([
    supabase.rpc("get_push_targets_for_message", { msg_id: body.messageId }),
    supabase.rpc("get_fcm_targets_for_message", { msg_id: body.messageId }),
  ]);
  if (webResult.error) {
    return NextResponse.json({ error: webResult.error.message }, { status: 500 });
  }
  const targets = (webResult.data ?? []) as PushTarget[];
  // FCM RPC may not exist yet on older databases — treat as empty so the
  // route keeps working until the migration is applied.
  const fcmTargets = (fcmResult.data ?? []) as FcmTarget[];
  if (fcmResult.error && fcmResult.error.code !== "PGRST202") {
    console.warn("get_fcm_targets_for_message failed:", fcmResult.error);
  }

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
  const stale: string[] = [];
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

  // FCM fan-out (Capacitor Android wrapper). Skipped silently if firebase
  // creds aren't configured — web-push above keeps working in that case.
  let fcmSent = 0;
  const fcmStale: string[] = [];
  const fcmShortBody =
    preview.length > 240 ? `${preview.slice(0, 237)}…` : preview;
  const messaging = fcmTargets.length > 0 ? getFcmMessaging() : null;
  if (messaging && fcmTargets.length > 0) {
    const fcmRes = await messaging.sendEachForMulticast({
      tokens: fcmTargets.map((t) => t.token),
      notification: { title, body: fcmShortBody },
      data: {
        url: `/c/${msg.conversation_id}`,
        conversationId: msg.conversation_id,
        messageId: msg.id,
      },
      android: {
        priority: "high",
        notification: { channelId: "default", tag: msg.conversation_id },
      },
    });
    fcmRes.responses.forEach((r, i) => {
      if (r.success) {
        fcmSent += 1;
      } else {
        const code = r.error?.code;
        // Token revoked / unregistered — clean it up so we don't keep trying.
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          fcmStale.push(fcmTargets[i].token);
        } else {
          console.warn("fcm send failed:", code, r.error?.message);
        }
      }
    });
    if (fcmStale.length > 0) {
      await supabase.from("fcm_tokens").delete().in("token", fcmStale);
    }
  }

  return NextResponse.json({
    sent,
    total: targets.length,
    stale: stale.length,
    fcmSent,
    fcmTotal: fcmTargets.length,
    fcmStale: fcmStale.length,
    fcmConfigured: messaging !== null,
  });
}
