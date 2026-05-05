import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install MessagingApp",
  description: "Install MessagingApp on your phone.",
  robots: { index: false, follow: false },
};

const APK_URL =
  "https://github.com/us41242/MessagingApp/releases/latest/download/messaging-app.apk";

export default function InstallPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Install MessagingApp
          </h1>
          <p className="text-sm text-zinc-500">
            One tap on your phone. No app store needed.
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Android
          </h2>
          <a
            href={APK_URL}
            className="mt-4 flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Download the APK
          </a>
          <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li>Tap the button above on your Android phone.</li>
            <li>Open the downloaded file when Chrome finishes.</li>
            <li>
              First time only: Android will ask if Chrome can install apps.
              Allow it.
            </li>
            <li>Tap Install. Done.</li>
          </ol>
          <p className="mt-3 text-xs text-zinc-500">
            Updates arrive automatically — open this page later and tap
            Download again to install the newest version on top.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            iPhone
          </h2>
          <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              Open <span className="font-medium">chat.alwayshave.fun</span>{" "}
              in Safari.
            </li>
            <li>
              Tap the Share button{" "}
              <span aria-hidden className="inline-block">
                (□↑)
              </span>
              .
            </li>
            <li>
              Scroll down → <span className="font-medium">Add to Home Screen</span>{" "}
              → Add.
            </li>
            <li>
              Open MessagingApp from the home screen icon (not Safari) — push
              notifications only work that way.
            </li>
          </ol>
          <p className="mt-3 text-xs text-zinc-500">
            iPhone install is a Progressive Web App. Same features as the
            Android build, packaged through Safari instead of an app store.
          </p>
        </section>
      </div>
    </main>
  );
}
