"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const THRESHOLD = 70;
const MAX_PULL = 120;
const RESISTANCE = 0.5;

// Mobile pull-to-refresh wrapper. Children scroll inside this element; while
// the user is at scrollTop=0, dragging down past THRESHOLD and releasing
// fires onRefresh. Defaults to router.refresh() — fast Next refetch of the
// surrounding server components without a full page reload (use a wrapper
// onRefresh that calls window.location.reload() if you specifically want a
// hard reload).
//
// Desktop / mouse-only environments: touch events don't fire, so this is a
// no-op there. Use F5 / Cmd+R.
export function PullToRefresh({
  onRefresh,
  children,
  className = "",
}: {
  onRefresh?: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (el.scrollTop > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing || startYRef.current === null) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        setPullDistance(0);
        return;
      }
      // Stop iOS Safari's native rubber-band reload while we're handling it
      if (el.scrollTop === 0 && dy > 5) e.preventDefault();
      setPullDistance(Math.min(dy * RESISTANCE, MAX_PULL));
    };

    const onTouchEnd = async () => {
      if (refreshing) return;
      const triggered = pullDistance >= THRESHOLD;
      startYRef.current = null;
      if (!triggered) {
        setPullDistance(0);
        return;
      }
      setRefreshing(true);
      setPullDistance(THRESHOLD);
      try {
        if (onRefresh) await onRefresh();
        else {
          router.refresh();
          // Visible spinner time so the refresh feels acknowledged even when
          // the new server payload arrives in <100ms.
          await new Promise((r) => setTimeout(r, 600));
        }
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pullDistance, refreshing, onRefresh, router]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto overscroll-y-contain ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center text-zinc-400 dark:text-zinc-500"
        style={{
          top: 0,
          height: `${pullDistance}px`,
          opacity: refreshing ? 1 : progress,
          transition: refreshing || pullDistance === 0 ? "height 200ms ease-out, opacity 200ms ease-out" : undefined,
        }}
      >
        <svg
          className={refreshing ? "animate-spin" : ""}
          style={{
            transform: refreshing ? undefined : `rotate(${progress * 360}deg)`,
          }}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 4 21 12 13 12" />
        </svg>
      </div>
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: refreshing || pullDistance === 0 ? "transform 200ms ease-out" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
