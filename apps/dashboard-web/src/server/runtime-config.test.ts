import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime-config";

const APPROVED_V3 = "https://examprep-api-4q2t5b27aa-el.a.run.app";

describe("V3 BFF runtime configuration", () => {
  it("requires an HTTPS production V3 base", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "production", VIJEETA_BUILD_ID: "b1" })).toThrow();
    expect(() => loadRuntimeConfig({ NODE_ENV: "production", VIJEETA_V3_BASE_URL: "http://localhost:8000" })).toThrow();
  });

  it("rejects fixture mode or local persistence in production", () => {
    const base = { NODE_ENV: "production", VIJEETA_V3_BASE_URL: APPROVED_V3, VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard", VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f" };
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_DATA_MODE: "fixture" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_PERSISTENCE_MODE: "local" })).toThrow();
  });

  it("returns bounded production config", () => {
    const config = loadRuntimeConfig({ NODE_ENV: "production", VIJEETA_V3_BASE_URL: `${APPROVED_V3}/`, VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard", VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f", VIJEETA_V3_TIMEOUT_MS: "4000", VIJEETA_BUILD_ID: "b1" });
    expect(config.baseUrl.toString()).toBe(`${APPROVED_V3}/`);
    expect(config.timeoutMs).toBe(4000);
    expect(config.mode).toBe("production");
    expect(config.firestoreDatabaseId).toBe("vijeeta-dashboard");
    expect(config.firebaseProjectId).toBe("neetcompanion-50b1f");
  });

  it("rejects the default or an unexpected Firestore database in production", () => {
    const base = { NODE_ENV: "production", VIJEETA_V3_BASE_URL: APPROVED_V3, VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f" };
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "(default)" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "default" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "other" })).toThrow();
  });

  it("requires the explicitly approved Firebase project in production", () => {
    const base = { NODE_ENV: "production", VIJEETA_V3_BASE_URL: APPROVED_V3, VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard" };
    expect(() => loadRuntimeConfig(base)).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "another-project" })).toThrow();
    expect(loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f" }).firebaseProjectId).toBe("neetcompanion-50b1f");
  });

  it("rejects any production V3 origin other than the approved examprep service", () => {
    const base = { NODE_ENV: "production", VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard", VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f" };
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_V3_BASE_URL: "https://attacker.example" })).toThrow(/approved/);
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_V3_BASE_URL: `${APPROVED_V3}/unexpected` })).toThrow(/approved/);
  });
});
