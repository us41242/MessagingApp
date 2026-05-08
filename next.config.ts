import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the friendly dev-hub hostnames + the Mac's tailnet identity to
  // hit /_next/* dev resources (HMR, fast-refresh). Without this, hitting
  // http://messages.local or http://macmini just shows a blank/uninteractive
  // page because hydration assets get cross-origin-blocked.
  allowedDevOrigins: [
    "messages.local",
    "macmini",
    "macmini.taile307c.ts.net",
    "100.99.231.54",
  ],
};

export default nextConfig;
