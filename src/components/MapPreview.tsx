"use client";

import { useEffect, useRef } from "react";
import L, { type Map as LMap } from "leaflet";
import "leaflet/dist/leaflet.css";

// The default Leaflet marker icon paths reference webpack-style assets that
// don't resolve under Next/Turbopack — use a CDN-hosted icon instead.
const ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function MapPreview({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (mapRef.current) return;
    const map = L.map(ref.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    L.marker([lat, lng], { icon: ICON }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  return <div ref={ref} className="h-full w-full" />;
}
