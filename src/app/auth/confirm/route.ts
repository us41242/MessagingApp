import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles both Supabase magic-link flows that can land here:
//   1. PKCE: ?code=...      (default for @supabase/ssr browser client)
//   2. Token hash: ?token_hash=...&type=magiclink  (legacy / templated emails)
// Whichever the email link uses, exchange it for a session cookie and
// redirect onward.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const failure = new URL("/login", url.origin);
  failure.searchParams.set("error", "verify_failed");
  return NextResponse.redirect(failure);
}
