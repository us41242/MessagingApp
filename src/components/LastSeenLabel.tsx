"use client";

import { useEffect, useState } from "react";
import { formatLastSeen } from "@/lib/format";

// Re-renders every 60s on a single shared timer so "5m ago" advances to
// "6m ago" without a server round-trip.
export function LastSeenLabel({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!iso) return null;
  const { label, isOnline } = formatLastSeen(iso, now);
  if (!label) return null;
  return (
    <span
      className={`flex items-center gap-1 text-[11px] ${
        isOnline ? "text-emerald-500" : "text-zinc-400"
      }`}
    >
      {isOnline ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      ) : null}
      {label}
    </span>
  );
}
