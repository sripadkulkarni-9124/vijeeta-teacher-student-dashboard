import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { FirestoreProfileStore, type FirestoreLike } from "./firestore-profile-store";
import {
  TokenVerificationError,
  bearerToken,
  type ProfileStore,
  type TokenVerifier,
} from "./profile-store";
import { loadRuntimeConfig, type V3RuntimeConfig } from "./runtime-config";

const FIREBASE_APP_NAME = "vijeeta-dashboard-server";
const DASHBOARD_DATABASE_ID = "vijeeta-dashboard";

interface FirebaseAuthLike {
  verifyIdToken(token: string): Promise<{ uid?: string }>;
}

export class FirebaseIdTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: FirebaseAuthLike) {}

  async verify(authorization: string): Promise<{ uid: string }> {
    try {
      const header = bearerToken(authorization);
      const decoded = await this.auth.verifyIdToken(header.slice("Bearer ".length));
      if (typeof decoded.uid !== "string" || !decoded.uid.trim()) throw new Error("Verified token has no UID");
      return { uid: decoded.uid };
    } catch (error) {
      if (isFirebaseDependencyFailure(error)) {
        throw new TokenVerificationError("Firebase token verifier is unavailable", 503);
      }
      throw new TokenVerificationError("Firebase authentication failed", 401);
    }
  }
}

export interface FirebaseServerRuntime {
  verifier: TokenVerifier;
  profiles: ProfileStore;
}

let runtimePromise: Promise<FirebaseServerRuntime> | undefined;

export async function getProductionFirebaseRuntime(config: V3RuntimeConfig = loadRuntimeConfig()): Promise<FirebaseServerRuntime> {
  if (config.mode !== "production") throw new TokenVerificationError("Firebase production runtime is unavailable", 503);
  const databaseId = assertDashboardDatabaseId(config.firestoreDatabaseId, config.mode);
  runtimePromise ??= Promise.resolve().then(() => {
    try {
      const existingApp = getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME);
      if (existingApp && existingApp.options.projectId !== config.firebaseProjectId) {
        throw new Error("Existing Firebase application is bound to another project");
      }
      const app = existingApp
        ?? initializeApp({ credential: applicationDefault(), projectId: config.firebaseProjectId }, FIREBASE_APP_NAME);
      const firestore = getFirestore(app, databaseId);
      return {
        verifier: new FirebaseIdTokenVerifier(getAuth(app)),
        profiles: new FirestoreProfileStore({
          firestore: firestore as unknown as FirestoreLike,
          serverTimestamp: () => FieldValue.serverTimestamp(),
        }),
      };
    } catch {
      throw new TokenVerificationError("Firebase production runtime is unavailable", 503);
    }
  });
  return runtimePromise;
}

export function assertDashboardDatabaseId(databaseId: string | undefined, mode: V3RuntimeConfig["mode"]): string {
  if (!databaseId || databaseId === "default" || databaseId === "(default)") {
    throw new Error("A named Firestore database is required");
  }
  if (mode === "production" && databaseId !== DASHBOARD_DATABASE_ID) {
    throw new Error(`Production Firestore database must be ${DASHBOARD_DATABASE_ID}`);
  }
  return databaseId;
}

export function resetFirebaseRuntimeForTests(): void {
  runtimePromise = undefined;
}

function isFirebaseDependencyFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && (
    code.startsWith("app/")
    || code === "auth/internal-error"
    || code === "auth/invalid-credential"
  );
}
