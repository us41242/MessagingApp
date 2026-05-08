"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const HEARTBEAT_MS = 60_000;

// Touches profiles.last_seen_at for the signed-in user every minute while
// the tab is visible, and immediately on mount + whenever the tab returns
// to the foreground. The "online" threshold on the read side is ~90s, so
// a 60s heartbeat with a 30s grace window keeps presence accurate without
// hammering the DB.
export function LastSeenHeartbeat({ meId }: { meId: string }) {
  const supabaseRef = useRef(createClient());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = supabaseRef.current;

    const ping = () => {
      supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", meId)
        .then(({ error }) => {
          if (error) console.error("heartbeat failed", error);
        });
    };

    const start = () => {
      if (timerRef.current != null) return;
      ping();
      timerRef.current = window.setInterval(ping, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    if (document.visibilityState === "visible") start();
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [meId]);

  return null;
}
