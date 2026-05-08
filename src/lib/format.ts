// Compact date formatting helpers for chat UI.

const today = () => new Date(new Date().toDateString());
const oneDay = 24 * 60 * 60 * 1000;

export function formatListTime(iso: string): string {
  const d = new Date(iso);
  const t = today().getTime();
  if (d.getTime() >= t) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (d.getTime() >= t - 6 * oneDay) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  if (d.getFullYear() === new Date().getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  const t = today().getTime();
  if (d.getTime() >= t) return "Today";
  if (d.getTime() >= t - oneDay) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// "online" / "last seen Xm ago". Threshold of 90s matches the heartbeat
// cadence (60s) plus a 30s grace window. Pass `now` to keep rendering
// pure during a 60s client tick.
export function formatLastSeen(
  iso: string | null,
  now: number = Date.now()
): { label: string; isOnline: boolean } {
  if (!iso) return { label: "", isOnline: false };
  const t = new Date(iso).getTime();
  const ageSec = Math.max(0, Math.floor((now - t) / 1000));
  if (ageSec < 90) return { label: "online", isOnline: true };
  if (ageSec < 60 * 60) {
    const m = Math.max(1, Math.floor(ageSec / 60));
    return { label: `last seen ${m}m ago`, isOnline: false };
  }
  if (ageSec < 24 * 60 * 60) {
    const h = Math.floor(ageSec / 3600);
    return { label: `last seen ${h}h ago`, isOnline: false };
  }
  if (ageSec < 7 * 24 * 60 * 60) {
    const d = Math.floor(ageSec / 86400);
    return { label: `last seen ${d}d ago`, isOnline: false };
  }
  return {
    label: `last seen ${new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`,
    isOnline: false,
  };
}
