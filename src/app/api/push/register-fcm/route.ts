import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save (or refresh) an FCM token for the signed-in user. Called from the
 * Capacitor Android wrapper at app launch via PushRegistration component.
 *
 * Body: { "token": "fcm-token-string", "platform": "android" }
 */
export async function POST(req: NextRequest) {
  let body: { token?: string; platform?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }
  const platform = (body.platform || "android").trim();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const userAgent = req.headers.get("user-agent") || null;

  // Upsert by token: same device re-registering refreshes last_used_at;
  // a token that was bound to a different profile now rebinds to the
  // currently signed-in user (rare but possible if devices change owners).
  const { error } = await supabase
    .from("fcm_tokens")
    .upsert(
      {
        profile_id: userId,
        token,
        platform,
        user_agent: userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) {
    console.error("fcm_tokens upsert failed", error);
    return NextResponse.json({ error: "save failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
