import { describe, expect, it } from "vitest";

import {
  FirestoreProfileStore,
  type FirestoreDocumentReference,
  type FirestoreDocumentSnapshot,
  type FirestoreLike,
  type FirestoreTransaction,
} from "./firestore-profile-store";

class FakeTimestamp {
  constructor(private readonly value: string) {}
  toDate(): Date { return new Date(this.value); }
}

class FakeFirestore implements FirestoreLike {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly collections: string[] = [];
  private transactionTail = Promise.resolve();

  collection(name: string) {
    this.collections.push(name);
    return { doc: (id: string) => this.reference(id) };
  }

  async runTransaction<T>(work: (transaction: FirestoreTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release = () => {};
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
      const result = await work({
        get: async (reference) => this.snapshot(reference.id),
        create: (reference, data) => { writes.push({ id: reference.id, data }); },
      });
      for (const write of writes) {
        if (this.documents.has(write.id)) throw new Error("already exists");
        this.documents.set(write.id, this.resolveServerTimestamps(write.data));
      }
      return result;
    } finally { release(); }
  }

  private reference(id: string): FirestoreDocumentReference {
    return { id, get: async () => this.snapshot(id) };
  }

  private snapshot(id: string): FirestoreDocumentSnapshot {
    const data = this.documents.get(id);
    return { exists: Boolean(data), data: () => data };
  }

  private resolveServerTimestamps(data: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [
      key,
      value === SERVER_TIMESTAMP ? new FakeTimestamp("2026-08-27T12:00:00.000Z") : value,
    ]));
  }
}

const SERVER_TIMESTAMP = Symbol("server timestamp");

function storeFor(db: FakeFirestore) {
  return new FirestoreProfileStore({
    firestore: db,
    serverTimestamp: () => SERVER_TIMESTAMP,
    randomUuid: () => "profile-uuid",
  });
}

describe("FirestoreProfileStore", () => {
  it("persists canonical V2 profiles while projecting pending Teachers to the legacy consumer", async () => {
    const db = new FakeFirestore();
    const store = storeFor(db);

    const created = await store.onboard("verified-firebase-uid", "teacher");

    expect(db.collections).toEqual(expect.arrayContaining(["profiles"]));
    expect(db.documents.has("verified-firebase-uid")).toBe(true);
    expect(created).toEqual({
      internalProfileId: "profile-uuid",
      firebaseUid: "verified-firebase-uid",
      allowedRoles: [],
      activeRole: null,
      onboardingCompleted: true,
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    });
    expect(db.documents.get("verified-firebase-uid")).toMatchObject({
      internalProfileId: "profile-uuid",
      firebaseUid: "verified-firebase-uid",
      verifiedEmail: null,
      displayName: null,
      roles: { teacher: "pending" },
      activeRole: null,
      onboardingCompleted: true,
      schemaVersion: 2,
    });
    expect(db.documents.get("verified-firebase-uid")).not.toHaveProperty("allowedRoles");
    await expect(store.getByFirebaseUid("verified-firebase-uid")).resolves.toEqual(created);
  });

  it("reads both historical legacy and canonical V2 profile documents", async () => {
    const db = new FakeFirestore();
    db.documents.set("legacy-uid", {
      internalProfileId: "legacy-profile",
      firebaseUid: "legacy-uid",
      allowedRoles: ["teacher"],
      activeRole: "teacher",
      onboardingCompleted: true,
      createdAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
      updatedAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
    });
    db.documents.set("canonical-uid", {
      internalProfileId: "canonical-profile",
      firebaseUid: "canonical-uid",
      verifiedEmail: "canonical@example.test",
      displayName: "Canonical",
      roles: { student: "active", teacher: "pending", admin: "active" },
      activeRole: "admin",
      onboardingCompleted: true,
      schemaVersion: 2,
      createdAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
      updatedAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
    });

    await expect(storeFor(db).getByFirebaseUid("legacy-uid")).resolves.toMatchObject({
      allowedRoles: ["teacher"], activeRole: "teacher",
    });
    await expect(storeFor(db).getByFirebaseUid("canonical-uid")).resolves.toMatchObject({
      allowedRoles: ["student"], activeRole: null,
    });
  });

  it("transactionally creates once under concurrent cross-role onboarding", async () => {
    const db = new FakeFirestore();
    const store = storeFor(db);

    const outcomes = await Promise.allSettled([
      store.onboard("same-verified-uid", "teacher"),
      store.onboard("same-verified-uid", "student"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "profile_exists" } });
    const persisted = await store.getByFirebaseUid("same-verified-uid");
    expect(persisted?.activeRole === null || persisted?.allowedRoles.includes(persisted.activeRole)).toBe(true);
  });

  it("never accepts a caller-supplied document identity during a read", async () => {
    const db = new FakeFirestore();
    db.documents.set("verified-uid", {
      internalProfileId: "profile-1",
      firebaseUid: "different-uid",
      allowedRoles: ["teacher"],
      activeRole: "teacher",
      onboardingCompleted: true,
      createdAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
      updatedAt: new FakeTimestamp("2026-08-27T12:00:00.000Z"),
    });

    await expect(storeFor(db).getByFirebaseUid("verified-uid")).rejects.toThrow("identity");
  });

  it("rejects unsafe verified UIDs before constructing a Firestore document path", async () => {
    const db = new FakeFirestore();
    const store = storeFor(db);
    const unsafeUids = ["", "   ", "contains/slash", "control\u0000uid", "x".repeat(129)];

    for (const uid of unsafeUids) {
      await expect(store.getByFirebaseUid(uid)).rejects.toThrow("safe Firestore document ID");
      await expect(store.onboard(uid, "student")).rejects.toThrow("safe Firestore document ID");
    }
    expect(db.collections).toEqual([]);
  });
});
