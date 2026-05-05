"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const GOOGLE_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Capacitor detection — guarded because window.Capacitor only exists inside
// the native wrapper. On regular web this returns false and we use the
// browser OAuth redirect flow instead.
function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-1" />}>
      <LoginInner />
    </Suspense>
  );
}

type Mode = "signin" | "signup" | "magic";

function LoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const socialInit = useRef(false);

  // One-time init of the native Google sign-in plugin inside the Capacitor
  // wrapper. No-op on the browser. The webClientId is the SAME OAuth client
  // ID Supabase is configured with — the id_token issued to the Android app
  // must have that audience for Supabase to accept it.
  useEffect(() => {
    if (!isNativeApp() || socialInit.current) return;
    if (!GOOGLE_WEB_CLIENT_ID) {
      console.warn("[login] NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID not set — native Google sign-in disabled");
      return;
    }
    socialInit.current = true;
    (async () => {
      try {
        const { SocialLogin } = await import("@capgo/capacitor-social-login");
        await SocialLogin.initialize({
          google: { webClientId: GOOGLE_WEB_CLIENT_ID, mode: "online" },
        });
      } catch (e) {
        console.error("[login] SocialLogin.initialize failed:", e);
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfo(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setBusy(false);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      router.push(next);
      router.refresh();
      return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        },
      });
      setBusy(false);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      if (data.session) {
        // Email confirmation disabled in project settings — straight in.
        router.push(next);
        router.refresh();
        return;
      }
      // Email confirmation required.
      setInfo(
        `Account created. Check ${email} to confirm — or have an admin disable "Confirm email" in Supabase → Authentication → Providers → Email.`
      );
      return;
    }

    // Magic link fallback
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    });
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setInfo(`Check ${email} for a magic link.`);
  }

  async function handleGoogle() {
    setBusy(true);
    setErrorMsg(null);
    const supabase = createClient();

    // Native Capacitor: use the system Google Sign-In flow (Play Services)
    // since Google blocks OAuth in WebViews. Returns an id_token that we
    // hand to Supabase via signInWithIdToken — same end state as the
    // browser redirect flow but no leaving-the-app moment.
    if (isNativeApp()) {
      try {
        const { SocialLogin } = await import("@capgo/capacitor-social-login");
        // Don't pass `scopes` here — the @capgo plugin's Android Credentials
        // path rejects custom scopes unless MainActivity implements a marker
        // interface, but it always includes email/profile/openid by default,
        // which is exactly what Supabase needs to verify the id_token.
        const res = await SocialLogin.login({ provider: "google", options: {} });
        const idToken =
          (res.result as { idToken?: string } | undefined)?.idToken;
        if (!idToken) {
          throw new Error("No id_token returned from Google sign-in");
        }
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });
        setBusy(false);
        if (error) {
          setErrorMsg(error.message);
          return;
        }
        router.push(next);
        router.refresh();
      } catch (e) {
        setBusy(false);
        setErrorMsg(e instanceof Error ? e.message : "Google sign-in failed");
      }
      return;
    }

    // Web: standard OAuth redirect.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      setErrorMsg(error.message);
    }
    // On success the browser navigates away to Google; no further work here.
  }

  const submitLabel = busy
    ? "Working…"
    : mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : "Send magic link";

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {mode === "signup"
            ? "Pick a password — no email round-trip."
            : mode === "signin"
              ? "Email and password."
              : "We'll email you a one-time link."}
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Continue with Google"
        >
          <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A8.99 8.99 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.32z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          or
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />

          {mode !== "magic" ? (
            <input
              type="password"
              required
              minLength={6}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitLabel}
          </button>

          {errorMsg ? (
            <p className="text-xs text-red-600">{errorMsg}</p>
          ) : null}
          {info ? (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {info}
            </div>
          ) : null}
        </form>

        <div className="mt-6 flex items-center justify-between text-xs text-zinc-500">
          {mode === "signin" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setErrorMsg(null);
                  setInfo(null);
                }}
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Create an account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("magic");
                  setErrorMsg(null);
                  setInfo(null);
                }}
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Email me a magic link
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrorMsg(null);
                setInfo(null);
              }}
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
