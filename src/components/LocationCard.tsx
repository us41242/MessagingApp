"use client";

import dynamic from "next/dynamic";

const MapPreview = dynamic(() => import("./MapPreview").then((m) => m.MapPreview), {
  ssr: false,
  loading: () => (
    <div className="h-40 w-72 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
  ),
});

export function LocationCard({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label: string | null;
}) {
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block w-full max-w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="h-40 w-full">
        <MapPreview lat={lat} lng={lng} />
      </div>
      <div className="px-3 py-2">
        <div className="text-sm font-medium">{label || "Pinned location"}</div>
        <div className="text-xs text-zinc-500">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      </div>
    </a>
  );
}
