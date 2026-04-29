"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
