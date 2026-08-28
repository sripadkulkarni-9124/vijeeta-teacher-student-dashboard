/**
 * Proves that the checked-in security rules for the named database
 * `vijeeta-dashboard` deny every client read and write.
 *
 * The server reaches Firestore through the Admin SDK, which bypasses rules, and
 * the browser ships no Firestore SDK. The rules are a backstop for the case
 * where a client credential is nonetheless pointed at this database, so the
 * property under test is simply: nothing a client can present is allowed.
 *
 * Skipped unless a Firestore emulator is configured, so ordinary `pnpm test`
 * stays hermetic. Run it against an emulator of your own, never a shared one:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8280 \
 *   pnpm --filter @vijeeta/dashboard-web exec vitest run src/test/firestore-rules.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, deleteDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Vitest runs with the app package as its root, so the repository root is two levels up.
const RULES_PATH = resolve(process.cwd(), "../../firestore.dashboard.rules");
const PROJECT_ID = "demo-vijeeta-dashboard";

/** Every document path the dashboard store writes, plus a path it never uses. */
const DOCUMENT_PATHS = [
  "profiles/uid-1",
  "profileEmailIndex/hash-1",
  "classrooms/class-1",
  "classrooms/class-1/members/uid-1",
  "classrooms/class-1/invites/invite-1",
  "classrooms/class-1/invites/invite-1/deliveryAttempts/attempt-1",
  "classrooms/class-1/assignments/assignment-1",
  "classrooms/class-1/outboundOperations/v3-share",
  "classrooms/class-1/inviteRateLimits/hash-1",
  "studentMemberships/uid-1/classes/class-1",
  "studentAssignments/uid-1/assignments/assignment-1",
  "mutationKeys/key-1",
  "auditEvents/event-1",
  "not-a-dashboard-collection/doc-1",
];

const COLLECTION_PATHS = ["profiles", "classrooms", "auditEvents", "classrooms/class-1/members"];
const COLLECTION_GROUPS = ["invites", "assignments", "members"];

function emulatorEndpoint(): { host: string; port: number } | undefined {
  const configured = process.env.FIRESTORE_EMULATOR_HOST;
  if (!configured) return undefined;
  const [host, port] = configured.split(":");
  if (!host || !port) return undefined;
  return { host, port: Number(port) };
}

const endpoint = emulatorEndpoint();
const gate = endpoint ? describe : describe.skip;

gate("vijeeta-dashboard firestore rules", () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(RULES_PATH, "utf8"), ...endpoint },
    });
  }, 60_000);

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    // Seed through the rules-disabled context so a denial is a real refusal,
    // not a missing document.
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      for (const path of DOCUMENT_PATHS) {
        await setDoc(doc(firestore, path), { seeded: true });
      }
    });
  });

  const clients = () => [
    { label: "unauthenticated", firestore: testEnvironment.unauthenticatedContext().firestore() },
    { label: "authenticated", firestore: testEnvironment.authenticatedContext("uid-1").firestore() },
    {
      label: "authenticated with an admin-looking token",
      firestore: testEnvironment
        .authenticatedContext("uid-1", { email: "gate-admin@example.test", email_verified: true, role: "admin", admin: true })
        .firestore(),
    },
  ];

  it("denies every client document read", async () => {
    for (const client of clients()) {
      for (const path of DOCUMENT_PATHS) {
        await assertFails(getDoc(doc(client.firestore, path)));
      }
    }
  });

  it("denies every client document write and delete", async () => {
    for (const client of clients()) {
      for (const path of DOCUMENT_PATHS) {
        await assertFails(setDoc(doc(client.firestore, path), { tampered: true }));
        await assertFails(deleteDoc(doc(client.firestore, path)));
      }
    }
  });

  it("denies client collection and collection-group queries", async () => {
    for (const client of clients()) {
      for (const path of COLLECTION_PATHS) {
        await assertFails(getDocs(query(collection(client.firestore, path))));
      }
      for (const group of COLLECTION_GROUPS) {
        await assertFails(getDocs(query(collectionGroup(client.firestore, group))));
      }
    }
  });

  it("leaves the seeded documents untouched", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      for (const path of DOCUMENT_PATHS) {
        const snapshot = await getDoc(doc(context.firestore(), path));
        expect(snapshot.data()).toEqual({ seeded: true });
      }
    });
  });
});
