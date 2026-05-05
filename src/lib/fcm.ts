import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

/**
 * Lazy firebase-admin initializer.
 *
 * Reads credentials from env. Two supported shapes:
 *   1. FIREBASE_SERVICE_ACCOUNT — full JSON contents from
 *      "Generate new private key" in Firebase Console (recommended for Vercel).
 *   2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY —
 *      the three fields broken out as separate vars (some hosts mangle
 *      multi-line JSON; this is the escape hatch).
 *
 * Returns null if no creds are configured — the notify route then skips FCM
 * gracefully so web-push keeps working until the user wires up Firebase.
 */
let cached: Messaging | null | undefined;

export function getFcmMessaging(): Messaging | null {
  if (cached !== undefined) return cached;

  const app = initFirebaseAdmin();
  cached = app ? getMessaging(app) : null;
  return cached;
}

function initFirebaseAdmin(): App | null {
  const existing = getApps()[0];
  if (existing) return existing;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    try {
      const creds = JSON.parse(json);
      return initializeApp({ credential: cert(creds) });
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT is not valid JSON:", e);
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKeyRaw) {
    // Vercel commonly stores the private key with literal \n sequences instead
    // of real newlines — normalize so the PEM parser is happy.
    const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  return null;
}
