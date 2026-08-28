/**
 * Pre-cloud three-role release gate.
 *
 * This harness drives the real route handlers, the real FirestoreDashboardStore,
 * the real FirestoreProfileStore, and the real FirebaseIdTokenVerifier against
 * loopback Auth and Firestore emulators. No production rule is relaxed:
 *
 * - the approved V3 origin stays pinned, and V3 is reached through an in-process
 *   fake transport, so the gate performs no network egress at all;
 * - invitation email uses the capture provider, so no SMTP connection is opened;
 * - the gate refuses to start unless both emulator hosts are loopback and no
 *   Cloud Run marker is present.
 *
 * What this gate does NOT cover: the Cloud Run runtime identity, the real
 * Firestore security rules, and real SMTP delivery. Those remain deployment
 * concerns and are called out in the evidence report.
 */
import { randomUUID } from "node:crypto";

import { ClassroomInvitationCoordinator } from "@/app/api/classes/route-support";
import { CaptureInvitationEmailProvider, type CapturedInvitationEmail } from "@/server/email-provider";
import { InviteTokenService } from "@/server/invite-token";
import { isReleaseGateMode, loadRuntimeConfig } from "@/server/runtime-config";
import { getProductionFirebaseRuntime, resetFirebaseRuntimeForTests } from "@/server/firebase-runtime";

const PROJECT_ID = "neetcompanion-50b1f";
const APPROVED_V3_ORIGIN = "https://examprep-api-4q2t5b27aa-el.a.run.app";
export const GATE_ADMIN_EMAIL = "gate-admin@example.test";

export interface GateIdentity {
  uid: string;
  email: string;
  idToken(): Promise<string>;
}

export function gateEnvironment(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    VIJEETA_RUNTIME_MODE: "production",
    VIJEETA_RELEASE_GATE_MODE: "loopback",
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    VIJEETA_V3_BASE_URL: `${APPROVED_V3_ORIGIN}/`,
    VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard",
    VIJEETA_FIREBASE_PROJECT_ID: PROJECT_ID,
    VIJEETA_BUILD_ID: "release-gate",
    VIJEETA_ADMIN_BOOTSTRAP_JSON: JSON.stringify({ version: 1, verifiedEmails: [GATE_ADMIN_EMAIL], firebaseUids: [] }),
    ...overrides,
  };
}

export function emulatorsConfigured(): boolean {
  try {
    return isReleaseGateMode({
      VIJEETA_RELEASE_GATE_MODE: "loopback",
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    });
  } catch {
    return false;
  }
}

function authEmulatorOrigin(): string {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("The release gate requires the Auth emulator");
  return `http://${host}`;
}

async function authEmulator(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${authEmulatorOrigin()}/identitytoolkit.googleapis.com/v1/${path}?key=release-gate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Auth emulator rejected ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

/** Clears emulator state so each gate run starts from an empty project. */
export async function resetEmulators(): Promise<void> {
  await fetch(`${authEmulatorOrigin()}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(`http://${firestore}/emulator/v1/projects/${PROJECT_ID}/databases/vijeeta-dashboard/documents`, { method: "DELETE" });
  resetFirebaseRuntimeForTests();
}

/**
 * Creates a verified identity. Email verification is set through the emulator so
 * the resulting ID token carries email_verified=true, exactly as a real verified
 * sign-in would.
 */
export async function createIdentity(email: string): Promise<GateIdentity> {
  const password = `Gate-${randomUUID()}`;
  const created = await authEmulator("accounts:signUp", { email, password, returnSecureToken: true });
  const uid = String(created.localId);
  // The emulator ignores emailVerified on a self-service update, so use its
  // privileged project endpoint. The "owner" bearer is emulator-only.
  const updated = await fetch(`${authEmulatorOrigin()}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ localId: uid, emailVerified: true, displayName: email.split("@")[0] }),
  });
  if (!updated.ok) throw new Error(`Auth emulator refused verification for ${email}: ${await updated.text()}`);
  return {
    uid,
    email,
    async idToken() {
      const signedIn = await authEmulator("accounts:signInWithPassword", { email, password, returnSecureToken: true });
      return String(signedIn.idToken);
    },
  };
}

export async function bearer(identity: GateIdentity): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await identity.idToken()}`, accept: "application/json" };
}

export interface GateRuntime {
  runtime: Awaited<ReturnType<typeof getProductionFirebaseRuntime>>;
  coordinator: ClassroomInvitationCoordinator;
  captures(): readonly CapturedInvitationEmail[];
}

/**
 * Builds the gate runtime from the production factory, so the gate exercises the
 * same store and verifier construction the Cloud Run service would use.
 */
export async function buildGateRuntime(): Promise<GateRuntime> {
  const env = gateEnvironment();
  const config = loadRuntimeConfig(env);
  if (!config.releaseGate) throw new Error("The release gate guard did not engage");
  const previous = { ...process.env };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    const runtime = await getProductionFirebaseRuntime(config);
    // The real capture provider, so the gate exercises the shipped delivery
    // validation instead of a hand-written stand-in. It opens no SMTP socket.
    const email = new CaptureInvitationEmailProvider({ runtimeMode: "development" });
    const coordinator = new ClassroomInvitationCoordinator({
      invitations: runtime.dashboard,
      tokens: new InviteTokenService({ pepper: "release-gate-pepper-value-at-least-32-chars" }),
      email,
      providerKind: "capture",
      dashboardUrl: "http://127.0.0.1:3010",
      runtimeMode: "development",
      createInvitationId: randomUUID,
    });
    return { runtime, coordinator, captures: () => email.captures };
  } finally {
    Object.keys(process.env).forEach((key) => { if (!(key in previous)) delete process.env[key]; });
    Object.entries(previous).forEach(([key, value]) => { if (value !== undefined) process.env[key] = value; });
  }
}

/** A strict V3 transport. Any unexpected call fails the gate rather than passing silently. */
export function strictV3Fetch(routes: Record<string, unknown>): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  calls: string[];
  unexpected: string[];
} {
  const calls: string[] = [];
  const unexpected: string[] = [];
  return {
    calls,
    unexpected,
    fetchImpl: async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.origin !== APPROVED_V3_ORIGIN) {
        unexpected.push(url);
        throw new Error(`The gate blocked a non-approved V3 origin: ${parsed.origin}`);
      }
      const key = `${init?.method ?? "GET"} ${parsed.pathname}`;
      calls.push(key);
      const body = routes[key];
      if (body === undefined) {
        unexpected.push(key);
        return new Response(JSON.stringify({ error: "unexpected" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

export function request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`http://127.0.0.1${url}`, init);
}

export function routeContext<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
