import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the Next.js MessagingApp as an installable Android app
 * (and later iOS, if we want it). We DON'T bundle the app's HTML/JS into
 * the APK — instead the wrapper loads the live web app over HTTPS via
 * `server.url`. The webDir below is a tiny fallback "Connecting…" page
 * that shows briefly while the URL loads (and is what the user sees if
 * the network is unreachable on launch).
 *
 * Update server.url to the public URL once Cloudflare Tunnel / Vercel /
 * whatever hosting you pick is live.
 */
const config: CapacitorConfig = {
  appId: 'fun.alwayshave.messaging',
  appName: 'MessagingApp',
  webDir: 'capacitor-fallback',
  server: {
    url: 'https://chat.alwayshave.fun',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
