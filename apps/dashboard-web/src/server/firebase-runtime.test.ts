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
  it("checks revocation and returns only the verified Firebase principal", async () => {
    const verifyIdToken = vi.fn(async () => ({
      uid: "canonical-uid",
      aud: "neetcompanion-50b1f",
      email: " Teacher@Example.TEST ",
      email_verified: true,
      name: "Teacher One",
      auth_time: 1_787_875_200,
      role: "forged",
    }));
    const verifier = new FirebaseIdTokenVerifier({ verifyIdToken }, "neetcompanion-50b1f");

    await expect(verifier.verify("Bearer signed-token")).resolves.toEqual({
      uid: "canonical-uid",
      email: "teacher@example.test",
      emailVerified: true,
      displayName: "Teacher One",
      authTime: "2026-08-28T00:00:00.000Z",
    });
    expect(verifyIdToken).toHaveBeenCalledWith("signed-token", true);
  });

  it("maps invalid tokens and malformed canonical principals to authentication failures", async () => {
    const invalid = new FirebaseIdTokenVerifier({ verifyIdToken: async () => { throw new Error("invalid"); } }, "neetcompanion-50b1f");
    const missingUid = new FirebaseIdTokenVerifier({ verifyIdToken: async () => ({ uid: "", aud: "neetcompanion-50b1f", auth_time: 1_787_875_200 }) }, "neetcompanion-50b1f");
    const missingAuthTime = new FirebaseIdTokenVerifier({ verifyIdToken: async () => ({ uid: "u1", aud: "neetcompanion-50b1f" }) }, "neetcompanion-50b1f");

    await expect(invalid.verify("Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(missingUid.verify("Bearer invalid" )).rejects.toMatchObject({ status: 401 });
    await expect(missingAuthTime.verify("Bearer invalid" )).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token decoded for a different Firebase project", async () => {
    const verifier = new FirebaseIdTokenVerifier({
      verifyIdToken: async () => ({ uid: "u1", aud: "another-project", auth_time: 1_787_875_200 }),
    }, "neetcompanion-50b1f");

    await expect(verifier.verify("Bearer signed-token")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an injected foreign project before token verification", () => {
    const verifyIdToken = vi.fn(async () => ({ uid: "u1", aud: "another-project", auth_time: 1_787_875_200 }));

    expect(() => new FirebaseIdTokenVerifier({ verifyIdToken }, "another-project")).toThrow(/project/i);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ["string", "true"],
    ["number", 1],
    ["object", { verified: true }],
    ["undefined", undefined],
  ])("rejects a non-boolean email_verified %s claim", async (_label, emailVerified) => {
    const verifier = new FirebaseIdTokenVerifier({
      verifyIdToken: async () => ({
        uid: "u1",
        aud: "neetcompanion-50b1f",
        email: "teacher@example.test",
        email_verified: emailVerified,
        auth_time: 1_787_875_200,
      }),
    }, "neetcompanion-50b1f");

    await expect(verifier.verify("Bearer signed-token")).rejects.toMatchObject({ status: 401 });
  });

  it("allows legitimately absent email and email_verified claims", async () => {
    const absentEmail = new FirebaseIdTokenVerifier({
      verifyIdToken: async () => ({ uid: "u1", aud: "neetcompanion-50b1f", auth_time: 1_787_875_200 }),
    }, "neetcompanion-50b1f");
    const absentVerification = new FirebaseIdTokenVerifier({
      verifyIdToken: async () => ({ uid: "u2", aud: "neetcompanion-50b1f", email: "teacher@example.test", auth_time: 1_787_875_200 }),
    }, "neetcompanion-50b1f");

    await expect(absentEmail.verify("Bearer signed-token")).resolves.toMatchObject({ email: null, emailVerified: false });
    await expect(absentVerification.verify("Bearer signed-token")).resolves.toMatchObject({ email: "teacher@example.test", emailVerified: false });
  });

  it("distinguishes a missing server credential from an invalid caller token", async () => {
    const credentialFailure = Object.assign(new Error("ADC unavailable"), { code: "app/invalid-credential" });
    const verifier = new FirebaseIdTokenVerifier({ verifyIdToken: async () => { throw credentialFailure; } }, "neetcompanion-50b1f");
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
      adminBootstrap: { version: 1, verifiedEmails: ["admin@example.test"], firebaseUids: [] },
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

  it("rejects an existing Firebase Admin application bound to another project", async () => {
    admin.getApps.mockReturnValue([{ name: "vijeeta-dashboard-server", options: { projectId: "another-project" } }]);

    await expect(getProductionFirebaseRuntime({
      baseUrl: new URL("https://v3.example.test"),
      timeoutMs: 5000,
      mode: "production",
      build: "test",
      firestoreDatabaseId: "vijeeta-dashboard",
      firebaseProjectId: "neetcompanion-50b1f",
      adminBootstrap: { version: 1, verifiedEmails: ["admin@example.test"], firebaseUids: [] },
    })).rejects.toMatchObject({ status: 503 });
  });

  it("rejects an injected foreign runtime project before Firebase Admin initialization", async () => {
    await expect(getProductionFirebaseRuntime({
      baseUrl: new URL("https://v3.example.test"),
      timeoutMs: 5000,
      mode: "production",
      build: "test",
      firestoreDatabaseId: "vijeeta-dashboard",
      firebaseProjectId: "another-project",
      adminBootstrap: { version: 1, verifiedEmails: ["admin@example.test"], firebaseUids: [] },
    })).rejects.toMatchObject({ status: 503 });
    expect(admin.initializeApp).not.toHaveBeenCalled();
  });
});
