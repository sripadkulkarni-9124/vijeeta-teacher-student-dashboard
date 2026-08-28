import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime-config";

const APPROVED_V3 = "https://examprep-api-4q2t5b27aa-el.a.run.app";
const BOOTSTRAP = JSON.stringify({ version: 1, verifiedEmails: ["admin@example.test"], firebaseUids: [] });
const productionBase = {
  NODE_ENV: "production",
  VIJEETA_V3_BASE_URL: APPROVED_V3,
  VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard",
  VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f",
  VIJEETA_ADMIN_BOOTSTRAP_JSON: BOOTSTRAP,
};

describe("V3 BFF runtime configuration", () => {
  it("requires an HTTPS production V3 base", () => {
    expect(() => loadRuntimeConfig({ ...productionBase, VIJEETA_V3_BASE_URL: undefined, VIJEETA_BUILD_ID: "b1" })).toThrow();
    expect(() => loadRuntimeConfig({ ...productionBase, VIJEETA_V3_BASE_URL: "http://localhost:8000" })).toThrow();
  });

  it("rejects fixture mode or local persistence in production", () => {
    const base = productionBase;
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_DATA_MODE: "fixture" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_PERSISTENCE_MODE: "local" })).toThrow();
  });

  it("returns bounded production config", () => {
    const config = loadRuntimeConfig({ ...productionBase, VIJEETA_V3_BASE_URL: `${APPROVED_V3}/`, VIJEETA_V3_TIMEOUT_MS: "4000", VIJEETA_BUILD_ID: "b1" });
    expect(config.baseUrl.toString()).toBe(`${APPROVED_V3}/`);
    expect(config.timeoutMs).toBe(4000);
    expect(config.mode).toBe("production");
    expect(config.firestoreDatabaseId).toBe("vijeeta-dashboard");
    expect(config.firebaseProjectId).toBe("neetcompanion-50b1f");
    expect(config.adminBootstrap).toEqual({ version: 1, verifiedEmails: ["admin@example.test"], firebaseUids: [] });
  });

  it("rejects the default or an unexpected Firestore database in production", () => {
    const base = productionBase;
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "(default)" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "default" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIRESTORE_DATABASE_ID: "other" })).toThrow();
  });

  it("requires the explicitly approved Firebase project in production", () => {
    const base = productionBase;
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: undefined })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "" })).toThrow();
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "another-project" })).toThrow();
    expect(loadRuntimeConfig({ ...base, VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f" }).firebaseProjectId).toBe("neetcompanion-50b1f");
  });

  it("rejects any production V3 origin other than the approved examprep service", () => {
    const base = productionBase;
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_V3_BASE_URL: "https://attacker.example" })).toThrow(/approved/);
    expect(() => loadRuntimeConfig({ ...base, VIJEETA_V3_BASE_URL: `${APPROVED_V3}/unexpected` })).toThrow(/approved/);
  });

  it("requires a valid Secret Manager-mounted Admin bootstrap in production", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "production", VIJEETA_ADMIN_BOOTSTRAP_JSON: "" })).toThrow(/bootstrap/);
    expect(() => loadRuntimeConfig({ ...productionBase, VIJEETA_ADMIN_BOOTSTRAP_JSON: undefined })).toThrow(/bootstrap/i);
    expect(() => loadRuntimeConfig({ ...productionBase, VIJEETA_ADMIN_BOOTSTRAP_JSON: "" })).toThrow(/bootstrap/i);
    expect(() => loadRuntimeConfig({ ...productionBase, VIJEETA_ADMIN_BOOTSTRAP_JSON: "not-json" })).toThrow(/bootstrap/i);
    expect(() => loadRuntimeConfig({
      ...productionBase,
      VIJEETA_ADMIN_BOOTSTRAP_JSON: JSON.stringify({ version: 1, verifiedEmails: [], firebaseUids: [] }),
    })).toThrow(/bootstrap/i);
  });

  it("uses an empty synthetic bootstrap outside production when none is configured", () => {
    expect(loadRuntimeConfig({ NODE_ENV: "test", VIJEETA_V3_BASE_URL: "http://localhost:8000" }).adminBootstrap).toEqual({
      version: 1,
      verifiedEmails: [],
      firebaseUids: [],
    });
  });
});

describe("release gate mode", () => {
  const gateEnv = {
    NODE_ENV: "production",
    VIJEETA_RUNTIME_MODE: "production",
    VIJEETA_RELEASE_GATE_MODE: "loopback",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    VIJEETA_V3_BASE_URL: "https://examprep-api-4q2t5b27aa-el.a.run.app/",
    VIJEETA_FIRESTORE_DATABASE_ID: "vijeeta-dashboard",
    VIJEETA_FIREBASE_PROJECT_ID: "neetcompanion-50b1f",
    VIJEETA_ADMIN_BOOTSTRAP_JSON: JSON.stringify({ version: 1, verifiedEmails: ["gate-admin@example.test"], firebaseUids: [] }),
  } as Record<string, string | undefined>;

  it("reports the gate without relaxing any production rule", () => {
    const config = loadRuntimeConfig(gateEnv);
    expect(config.releaseGate).toBe(true);
    expect(config.mode).toBe("production");
    expect(config.baseUrl.origin).toBe("https://examprep-api-4q2t5b27aa-el.a.run.app");
  });

  it("still pins the approved V3 origin while the gate is on", () => {
    expect(() => loadRuntimeConfig({ ...gateEnv, VIJEETA_V3_BASE_URL: "http://127.0.0.1:9188/" }))
      .toThrow(/approved examprep service origin/);
  });

  it("refuses to run on Cloud Run", () => {
    expect(() => loadRuntimeConfig({ ...gateEnv, K_SERVICE: "vijeeta-dashboard" })).toThrow(/cannot run on Cloud Run/);
  });

  it("refuses a non-loopback emulator host", () => {
    expect(() => loadRuntimeConfig({ ...gateEnv, FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }))
      .toThrow(/loopback Auth and Firestore emulators/);
  });

  it("refuses when an emulator host is missing", () => {
    expect(() => loadRuntimeConfig({ ...gateEnv, FIREBASE_AUTH_EMULATOR_HOST: undefined }))
      .toThrow(/loopback Auth and Firestore emulators/);
  });

});
