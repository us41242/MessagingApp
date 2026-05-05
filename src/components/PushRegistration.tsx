"use client";

import { useEffect } from "react";

/**
 * Capacitor-only push notification bootstrap.
 *
 * Mounts in the root layout. On a regular browser visit it does nothing.
 * Inside the Capacitor Android app, it:
 *   1. Asks the OS for POST_NOTIFICATIONS permission (Android 13+ prompts).
 *   2. Calls PushNotifications.register() — the OS now sees the app as
 *      a notification-sending app, so the "this app does not send
 *      notifications" line in app settings goes away.
 *   3. Receives the FCM token via the registration callback and POSTs it
 *      to /api/push/register-fcm so the server can target this device
 *      when delivering push messages.
 *
 * Listener cleanup on unmount keeps things tidy if the layout ever remounts
 * (HMR, etc.).
 */
export function PushRegistration() {
  useEffect(() => {
    let alive = true;
    const handles: { remove: () => void }[] = [];

    (async () => {
      // Capacitor injects a global. Skip silently on regular web.
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (!cap?.isNativePlatform?.()) return;

      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Ask for permission
        const existing = await PushNotifications.checkPermissions();
        let receive = existing.receive;
        if (receive !== "granted") {
          const requested = await PushNotifications.requestPermissions();
          receive = requested.receive;
        }
        if (!alive) return;
        if (receive !== "granted") {
          console.warn("[push] permission not granted:", receive);
          return;
        }

        // Wire listeners BEFORE register so we don't miss the first emit
        const reg = await PushNotifications.addListener("registration", async (token) => {
          if (!alive) return;
          try {
            const r = await fetch("/api/push/register-fcm", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token: token.value, platform: "android" }),
            });
            if (!r.ok) {
              console.error("[push] failed to save token:", r.status, await r.text());
            }
          } catch (e) {
            console.error("[push] token POST failed:", e);
          }
        });
        const err = await PushNotifications.addListener("registrationError", (e) => {
          console.error("[push] registration error:", e);
        });
        const got = await PushNotifications.addListener("pushNotificationReceived", (n) => {
          console.log("[push] foreground notification:", n);
        });
        const tap = await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
          console.log("[push] tapped:", a);
        });
        handles.push(reg, err, got, tap);

        // Now register with FCM. Triggers the "registration" callback above.
        await PushNotifications.register();
      } catch (e) {
        console.error("[push] init failed:", e);
      }
    })();

    return () => {
      alive = false;
      handles.forEach((h) => h.remove());
    };
  }, []);

  return null;
}
