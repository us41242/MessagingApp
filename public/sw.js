// Service worker for Web Push delivery + click handling.
// The push payload shape is dictated by /api/push/notify.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    // not JSON — leave data as {}
  }
  const title = data.title || "New message";
  const url = data.url || "/";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || "message",
    data: { url },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          try {
            const u = new URL(w.url);
            if (u.pathname === url) return w.focus();
          } catch (_) {
            // ignore
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

// If the browser rotates the subscription, the old endpoint stops working.
// Re-subscribe and notify the server. The client also picks this up at
// next page load, but doing it here keeps push working without a refresh.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.subscribe(
          event.oldSubscription?.options || { userVisibleOnly: true }
        );
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (_) {
        // best-effort
      }
    })()
  );
});
