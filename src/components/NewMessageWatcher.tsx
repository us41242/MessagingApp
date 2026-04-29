"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type MessageInsertRow = {
  id: string;
  sender_id: string | null;
  body: string | null;
  conversation_id: string;
};

type SenderProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
} | null;

// Layout-level realtime listener. Subscribes once for the whole app and
// fires sound/title/notification cues whenever a message arrives that
// wasn't sent by the current user. Lives outside any Thread component so
// alerts work regardless of which page is open.
export function NewMessageWatcher({
  meId,
  email,
}: {
  meId: string;
  email: string | null;
}) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const unreadRef = useRef(0);
  const baseTitleRef = useRef("Messages");

  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );
  const [audioReady, setAudioReady] = useState(false);

  // Capture the original tab title so we can restore it.
  useEffect(() => {
    if (typeof document !== "undefined" && document.title) {
      baseTitleRef.current = document.title;
    }
  }, []);

  // When the user comes back to the tab, clear the unread badge in the title.
  useEffect(() => {
    const handler = () => {
      if (!document.hidden) {
        unreadRef.current = 0;
        document.title = baseTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Read current notification permission once, on mount.
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
  }, []);

  // Web Audio needs a user gesture before it will play. Treat the
  // "Enable sound" interaction as that gesture, and detect via a sentinel.
  // (If the user has already interacted with the page in any way and we
  // try to play, autoplay policies may still allow a quiet ping; we
  // gracefully swallow any AudioContext errors.)
  useEffect(() => {
    const onFirstClick = () => setAudioReady(true);
    document.addEventListener("click", onFirstClick, { once: true });
    document.addEventListener("keydown", onFirstClick, { once: true });
    return () => {
      document.removeEventListener("click", onFirstClick);
      document.removeEventListener("keydown", onFirstClick);
    };
  }, []);

  const playPing = useCallback(() => {
    if (!audioReady) return;
    try {
      type AudioCtor = typeof AudioContext;
      const Ctor: AudioCtor | undefined =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      // Two-note ping: drop from B5 to E5
      osc.frequency.setValueAtTime(987.77, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch {
      // ignore
    }
  }, [audioReady]);

  // Subscribe once for the user's lifetime in the app.
  useEffect(() => {
    const channel = supabase
      .channel(`user-msgs-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row = payload.new as MessageInsertRow;
          if (!row || row.sender_id === meId) return;

          // Ping is the universal signal: even if you're staring at the
          // chat, you get an audible confirmation that something landed.
          playPing();

          if (document.hidden) {
            unreadRef.current += 1;
            document.title = `(${unreadRef.current}) ${baseTitleRef.current}`;
          }

          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            // Resolve the sender's display name for a friendlier title.
            const { data: senderRow } = await supabase
              .from("profiles")
              .select("id, display_name, avatar_url")
              .eq("id", row.sender_id ?? "")
              .maybeSingle();
            const sender = senderRow as SenderProfile;
            const title = sender?.display_name
              ? `${sender.display_name}`
              : "New message";
            const bodyText = row.body
              ? row.body
              : "Sent an attachment";
            try {
              const n = new Notification(title, {
                body: bodyText,
                icon: sender?.avatar_url || undefined,
                tag: row.conversation_id,
              });
              n.onclick = () => {
                window.focus();
                window.location.href = `/c/${row.conversation_id}`;
                n.close();
              };
            } catch {
              // Notification constructor throws on some platforms; ignore.
            }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, playPing]);

  // Quietly use `email` so future toggles can key per-user prefs.
  void email;

  if (permission === "default") {
    return (
      <button
        type="button"
        onClick={async () => {
          if (typeof Notification === "undefined") return;
          const result = await Notification.requestPermission();
          setPermission(result);
        }}
        className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Enable notifications
      </button>
    );
  }

  return null;
}
