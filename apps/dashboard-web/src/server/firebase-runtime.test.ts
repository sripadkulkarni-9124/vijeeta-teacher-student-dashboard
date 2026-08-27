import { beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({
  applicationDefault: vi.fn(() => ({ kind: "adc" })),
  getApps: vi.fn(() => [] as Array<{ name: string; options: { projectId?: string } }>),
  initializeApp: vi.fn((options: { projectId?: string }, name: string) => ({ name, options })),
  getAuth: vi.fn(() => ({ verifyIdToken: vi.fn() })),
  getFirestore: vi.fn(() => ({ collection: vi.fn(), runTransaction: vi.fn() })),
  serverTimestamp: vi.fn(() => ({ kind: "server-timestamp" })),
}));

vi.mock("firebase-admin/app", () => ({
  applicationDefault: admin.applicationDefault,
  getApps: admin.getApps,
  initializeApp: admin.initializeApp,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: admin.getAuth }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: admin.getFirestore,
  FieldValue: { serverTimestamp: admin.serverTimestamp },
}));

import {
  FirebaseIdTokenVerifier,
  assertDashboardDatabaseId,
  getProductionFirebaseRuntime,
  resetFirebaseRuntimeForTests,
} from "./firebase-runtime";

beforeEach(() => {
  resetFirebaseRuntimeForTests();
  vi.clearAllMocks();
  admin.getApps.mockReturnValue([]);
});

describe("FirebaseIdTokenVerifier", () => {
  it("verifies only the bearer token and returns the canonical Firebase UID", async () => {
    const verifyIdToken = vi.fn(async () => ({ uid: "canonical-uid", email: "ignored@example.test", role: "forged" }));
    const verifier = new FirebaseIdTokenVerifier({ verifyIdToken });

    await expect(verifier.verify("Bearer signed-token")).resolves.toEqual({ uid: "canonical-uid" });
    expect(verifyIdToken).toHaveBeenCalledWith("signed-token");
  });

  it("maps invalid tokens and missing canonical UIDs to authentication failures", async () => {
    const invalid = new FirebaseIdTokenVerifier({ verifyIdToken: async () => { throw new Error("invalid"); } });
    const missingUid = new FirebaseIdTokenVerifier({ verifyIdToken: async () => ({ uid: "" }) });

    await expect(invalid.verify("Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(missingUid.verify("Bearer invalid" )).rejects.toMatchObject({ status: 401 });
  });

  it("distinguishes a missing server credential from an invalid caller token", async () => {
    const credentialFailure = Object.assign(new Error("ADC unavailable"), { code: "app/invalid-credential" });
    const verifier = new FirebaseIdTokenVerifier({ verifyIdToken: async () => { throw credentialFailure; } });
    await expect(verifier.verify("Bearer signed-token")).rejects.toMatchObject({ status: 503 });
  });
});

describe("Firestore database guard", () => {
  it("requires the dedicated named dashboard database in production", () => {
    expect(assertDashboardDatabaseId("vijeeta-dashboard", "production")).toBe("vijeeta-dashboard");
    expect(() => assertDashboardDatabaseId("default", "production")).toThrow();
    expect(() => assertDashboardDatabaseId("(default)", "production")).toThrow();
    expect(() => assertDashboardDatabaseId("another-database", "production")).toThrow();
    expect(() => assertDashboardDatabaseId(undefined, "production")).toThrow();
  });

  it("initializes Firebase Admin with ADC and the exact approved project/database", async () => {
    await getProductionFirebaseRuntime({
      baseUrl: new URL("https://v3.example.test"),
      timeoutMs: 5000,
      mode: "production",
      build: "test",
      firestoreDatabaseId: "vijeeta-dashboard",
      firebaseProjectId: "neetcompanion-50b1f",
    });

    expect(admin.applicationDefault).toHaveBeenCalledOnce();
    expect(admin.initializeApp).toHaveBeenCalledWith(
      { credential: { kind: "adc" }, projectId: "neetcompanion-50b1f" },
      "vijeeta-dashboard-server",
    );
    expect(admin.getFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ name: "vijeeta-dashboard-server" }),
      "vijeeta-dashboard",
    );
  });
});
