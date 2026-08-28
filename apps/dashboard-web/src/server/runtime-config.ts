import type { AdminBootstrapConfig } from "@vijeeta/api-contracts";

import { parseAdminBootstrap } from "./admin-bootstrap";

export interface V3RuntimeConfig {
  baseUrl: URL;
  timeoutMs: number;
  mode: "production" | "development" | "test";
  build: string;
  firestoreDatabaseId: string;
  firebaseProjectId: string;
  releaseGate: boolean;
  adminBootstrap: AdminBootstrapConfig;
}

const APPROVED_PRODUCTION_V3_ORIGIN = "https://examprep-api-4q2t5b27aa-el.a.run.app";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHost(value: string): boolean {
  const host = value.includes("://") ? safeHostname(value) : value.split(":")[0];
  return host !== null && LOOPBACK_HOSTNAMES.has(host);
}

function safeHostname(value: string): string | null {
  try { return new URL(value).hostname; } catch { return null; }
}

/**
 * The pre-cloud release gate runs the production runtime against loopback Auth
 * and Firestore emulators. It never relaxes a production rule: the approved V3
 * origin is still pinned, and the gate reaches V3 through an in-process fake
 * transport rather than the network. Enabling it requires the explicit opt-in,
 * the absence of any Cloud Run marker, and loopback emulator hosts.
 */
export function isReleaseGateMode(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  if (env.VIJEETA_RELEASE_GATE_MODE !== "loopback") return false;
  if (env.K_SERVICE || env.K_REVISION || env.K_CONFIGURATION) {
    throw new Error("The release gate cannot run on Cloud Run");
  }
  const auth = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestore = env.FIRESTORE_EMULATOR_HOST;
  if (!auth || !firestore) throw new Error("The release gate requires loopback Auth and Firestore emulators");
  if (!isLoopbackHost(auth) || !isLoopbackHost(firestore)) {
    throw new Error("The release gate requires loopback Auth and Firestore emulators");
  }
  return true;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): V3RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const mode = env.VIJEETA_RUNTIME_MODE === "production" || nodeEnv === "production" ? "production" : nodeEnv === "test" ? "test" : "development";
  const bootstrapJson = env.VIJEETA_ADMIN_BOOTSTRAP_JSON;
  if (mode === "production" && !bootstrapJson) throw new Error("Admin bootstrap configuration is required");
  const baseValue = env.VIJEETA_V3_BASE_URL ?? env.VIJEETA_V3_API_BASE_URL;
  if (!baseValue) throw new Error("VIJEETA_V3_BASE_URL is required");
  let baseUrl: URL;
  try { baseUrl = new URL(baseValue); } catch { throw new Error("VIJEETA_V3_BASE_URL must be an absolute URL"); }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("V3 base URL must not contain credentials or query state");
  const releaseGate = isReleaseGateMode(env);
  if (mode === "production") {
    const approved = new URL(APPROVED_PRODUCTION_V3_ORIGIN);
    const hasUnexpectedPath = baseUrl.pathname !== "/";
    if (baseUrl.origin !== approved.origin || hasUnexpectedPath) {
      throw new Error("Production V3 base URL must use the approved examprep service origin");
    }
  }
  if (mode === "production" && (env.VIJEETA_DATA_MODE === "fixture" || env.VIJEETA_PERSISTENCE_MODE === "local")) throw new Error("Fixture/local persistence is not allowed in production");
  const firestoreDatabaseId = env.VIJEETA_FIRESTORE_DATABASE_ID ?? (mode === "production" ? "" : "vijeeta-dashboard");
  if (firestoreDatabaseId === "default" || firestoreDatabaseId === "(default)") throw new Error("A named Firestore database is required");
  if (mode === "production" && firestoreDatabaseId !== "vijeeta-dashboard") throw new Error("Production Firestore database must be vijeeta-dashboard");
  const firebaseProjectId = env.VIJEETA_FIREBASE_PROJECT_ID ?? (mode === "production" ? "" : "neetcompanion-50b1f");
  if (mode === "production" && firebaseProjectId !== "neetcompanion-50b1f") throw new Error("Production Firebase project must be neetcompanion-50b1f");
  const adminBootstrap = bootstrapJson
    ? parseAdminBootstrap(bootstrapJson)
    : { version: 1 as const, verifiedEmails: [], firebaseUids: [] };
  if (mode === "production" && adminBootstrap.verifiedEmails.length === 0 && adminBootstrap.firebaseUids.length === 0) {
    throw new Error("Admin bootstrap configuration requires at least one identity");
  }
  const timeoutMs = Number(env.VIJEETA_V3_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15000) throw new Error("V3 timeout must be between 250ms and 15000ms");
  return { baseUrl, timeoutMs, mode, releaseGate, build: env.VIJEETA_BUILD_ID ?? "unknown", firestoreDatabaseId, firebaseProjectId, adminBootstrap };
}
