import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const FIREBASE_AUTH_HANDLER_ORIGIN = "https://neetcompanion-50b1f.firebaseapp.com";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Serve Firebase's sign-in helper from this origin.
   *
   * signInWithRedirect hands the credential back through the authDomain's
   * storage. When that domain differs from the app's, browsers partition the
   * storage and the handoff is dropped, so the viewer returns signed out and
   * bounces to the sign-in screen. Proxying the handler makes authDomain the
   * app's own origin, which removes the cross-origin step entirely.
   */
  async rewrites() {
    return [
      { source: "/__/auth/:path*", destination: `${FIREBASE_AUTH_HANDLER_ORIGIN}/__/auth/:path*` },
    ];
  },
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@vijeeta/api-contracts",
    "@vijeeta/configuration",
    "@vijeeta/design-system",
  ],
};

export default nextConfig;
