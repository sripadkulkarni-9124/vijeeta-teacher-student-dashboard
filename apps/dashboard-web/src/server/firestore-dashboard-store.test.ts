import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AdminBootstrapConfig, AuditEvent, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AuditEmitter } from "./audit";
import type { MutationContext } from "./dashboard-store";
import {
  FirestoreDashboardStore,
  type FirestoreCollectionReference,
  type FirestoreDashboardDocumentReference,
  type FirestoreDashboardDocumentSnapshot,
  type FirestoreDashboardLike,
  type FirestoreDashboardTransaction,
  type FirestoreQuery,
  type FirestoreQuerySnapshot,
} from "./firestore-dashboard-store";

type StoredDocument = Record<string, unknown>;
type Write =
  | { operation: "create"; path: string; data: StoredDocument }
  | { operation: "update"; path: string; data: StoredDocument };

class FakeDocumentReference implements FirestoreDashboardDocumentReference {
  readonly id: string;

  constructor(
    readonly path: string,
    private readonly database: FakeFirestore,
  ) {
    this.id = path.split("/").at(-1) ?? "";
  }

  collection(name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(`${this.path}/${name}`, this.database);
  }

  async get(): Promise<FirestoreDashboardDocumentSnapshot> {
    return this.database.snapshot(this.path);
  }
}

class FakeQuery implements FirestoreQuery {
  constructor(
    protected readonly database: FakeFirestore,
    private readonly collectionPath: string,
    private readonly filters: ReadonlyArray<{ field: string; value: unknown }> = [],
    private readonly ordering?: { field: string; direction: "asc" | "desc" },
    private readonly maximum?: number,
  ) {}

  where(field: string, operator: "==", value: unknown): FirestoreQuery {
    expect(operator).toBe("==");
    return new FakeQuery(this.database, this.collectionPath, [...this.filters, { field, value }], this.ordering, this.maximum);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.filters, { field, direction }, this.maximum);
  }

  limit(maximum: number): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.filters, this.ordering, maximum);
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    const prefix = `${this.collectionPath}/`;
    let documents = [...this.database.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) => this.filters.every((filter) => data[filter.field] === filter.value));
    if (this.ordering) {
      const { field, direction } = this.ordering;
      documents = documents.sort((left, right) => String(left[1][field]).localeCompare(String(right[1][field])) * (direction === "asc" ? 1 : -1));
    }
    if (this.maximum !== undefined) documents = documents.slice(0, this.maximum);
    return {
      docs: documents.map(([path]) => this.database.snapshot(path)),
    };
  }
}

class FakeCollectionReference extends FakeQuery implements FirestoreCollectionReference {
  constructor(
    readonly path: string,
    database: FakeFirestore,
  ) {
    super(database, path);
  }

  doc(id: string): FirestoreDashboardDocumentReference {
    return new FakeDocumentReference(`${this.path}/${id}`, this.database);
  }
}

class FakeFirestore implements FirestoreDashboardLike {
  readonly documents = new Map<string, StoredDocument>();
  readonly committedWrites: Write[] = [];
  failCreateCollection: string | undefined;

  collection(name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(name, this);
  }

  async runTransaction<T>(work: (transaction: FirestoreDashboardTransaction) => Promise<T>): Promise<T> {
    const writes: Write[] = [];
    const transaction: FirestoreDashboardTransaction = {
      get: async (reference) => this.snapshot(reference.path),
      create: (reference, data) => { writes.push({ operation: "create", path: reference.path, data }); },
      update: (reference, data) => { writes.push({ operation: "update", path: reference.path, data }); },
    };
    const result = await work(transaction);

    const projected = new Map(this.documents);
    for (const write of writes) {
      const collection = write.path.split("/").at(-2);
      if (write.operation === "create" && collection === this.failCreateCollection) throw new Error("injected create failure");
      if (write.operation === "create" && projected.has(write.path)) throw Object.assign(new Error("already exists"), { code: 6 });
      if (write.operation === "update" && !projected.has(write.path)) throw new Error("missing update target");
      const current = projected.get(write.path) ?? {};
      projected.set(write.path, write.operation === "create" ? structuredClone(write.data) : { ...current, ...structuredClone(write.data) });
    }
    this.documents.clear();
    for (const [path, data] of projected) this.documents.set(path, data);
    this.committedWrites.push(...writes);
    return result;
  }

  snapshot(path: string): FirestoreDashboardDocumentSnapshot {
    const data = this.documents.get(path);
    return {
      id: path.split("/").at(-1) ?? "",
      exists: data !== undefined,
      data: () => data === undefined ? undefined : structuredClone(data),
    };
  }

  created(collection: string): Write[] {
    return this.committedWrites.filter((write) => write.operation === "create" && write.path.split("/").at(-2) === collection);
  }
}

class CapturingAuditEmitter implements AuditEmitter {
  readonly events: AuditEvent[] = [];

  async emit(event: AuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

const NOW = "2026-08-28T08:00:00.000Z";
const AUTH_TIME = "2026-08-28T07:55:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const BOOTSTRAP: AdminBootstrapConfig = {
  version: 1,
  verifiedEmails: ["admin@example.com"],
  firebaseUids: [],
};

const adminPrincipal = principal("admin-uid", "admin@example.com", true);
const teacherPrincipal = principal("teacher-uid", "teacher@example.com", true);
const otherTeacherPrincipal = principal("other-teacher-uid", "other.teacher@example.com", true);

function principal(uid: string, email: string | null, emailVerified: boolean): VerifiedPrincipal {
  return { uid, email, emailVerified, displayName: `${uid} display`, authTime: AUTH_TIME };
}

function context(reason?: string): MutationContext {
  return { now: NOW, correlationId: CORRELATION_ID, ...(reason === undefined ? {} : { reason }) };
}

function storeFor(database: FakeFirestore, emitter = new CapturingAuditEmitter()): { store: FirestoreDashboardStore; emitter: CapturingAuditEmitter } {
  let sequence = 0;
  return {
    store: new FirestoreDashboardStore({
      firestore: database,
      databaseId: "vijeeta-dashboard",
      auditEmitter: emitter,
      randomUuid: () => `generated-${++sequence}`,
      now: () => NOW,
      correlationId: () => CORRELATION_ID,
    }),
    emitter,
  };
}

async function activeTeacher(store: FirestoreDashboardStore, principalToApprove = teacherPrincipal): Promise<void> {
  await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
  await store.onboard(principalToApprove, { role: "teacher" }, context());
  await store.approveTeacher(adminPrincipal, principalToApprove.uid, context("Identity reviewed"));
}

describe("FirestoreDashboardStore", () => {
  it("rejects default or foreign databases and exposes no runtime delete method", () => {
    const database = new FakeFirestore();
    const emitter = new CapturingAuditEmitter();

    for (const databaseId of ["default", "(default)", "another-database"]) {
      expect(() => new FirestoreDashboardStore({ firestore: database, databaseId, auditEmitter: emitter })).toThrow(/vijeeta-dashboard/);
    }
    const { store } = storeFor(database);
    expect("delete" in store).toBe(false);
    expect("delete" in ({
      get: async (reference: FirestoreDashboardDocumentReference) => database.snapshot(reference.path),
      create: () => {},
      update: () => {},
    } satisfies FirestoreDashboardTransaction)).toBe(false);
  });

  it("requires a verified email for bootstrap and grants a matching identity exactly once", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    const unverified = principal("admin-uid", "admin@example.com", false);

    await expect(store.bootstrapAdmin(unverified, BOOTSTRAP, context())).rejects.toMatchObject({ code: "verified_email_required" });
    const first = await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP);
    const second = await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP);

    expect(second.internalProfileId).toBe(first.internalProfileId);
    expect(first.roles).toEqual({ admin: "active" });
    expect(database.created("auditEvents")).toHaveLength(1);
    expect(database.created("auditEvents")[0]?.data).toMatchObject({ action: "admin.bootstrap", actorUid: "admin-uid" });
    expect(emitter.events.map((auditEvent) => auditEvent.action)).toEqual(["admin.bootstrap"]);
  });

  it("creates a pending Teacher profile and a hashed verified-email index in one transaction", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);

    const profile = await store.onboard(teacherPrincipal, { role: "teacher" }, context());

    const emailHash = createHash("sha256").update("teacher@example.com").digest("hex");
    expect(profile.roles).toEqual({ teacher: "pending" });
    expect(profile.activeRole).toBeNull();
    expect(database.documents.get(`profileEmailIndex/${emailHash}`)).toEqual({
      normalizedEmail: "teacher@example.com",
      firebaseUid: "teacher-uid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(database.created("profiles")).toHaveLength(1);
    expect(database.created("profileEmailIndex")).toHaveLength(1);
    expect(database.created("auditEvents")).toHaveLength(1);
  });

  it("fails a verified-email collision closed without a profile or audit side effect", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    const emailHash = createHash("sha256").update("teacher@example.com").digest("hex");
    database.documents.set(`profileEmailIndex/${emailHash}`, {
      normalizedEmail: "teacher@example.com",
      firebaseUid: "hostile-existing-uid",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(store.onboard(teacherPrincipal, { role: "teacher" }, context())).rejects.toMatchObject({ code: "email_index_collision" });

    expect(database.documents.has("profiles/teacher-uid")).toBe(false);
    expect(database.created("auditEvents")).toHaveLength(0);
    expect(emitter.events).toEqual([]);
  });

  it("allows only an active Admin to approve and suspend a pending Teacher with audited reasons", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(teacherPrincipal, { role: "teacher" }, context());

    await expect(store.approveTeacher(otherTeacherPrincipal, teacherPrincipal.uid, context("Forged approval"))).rejects.toMatchObject({ code: "admin_required" });
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    const approved = await store.approveTeacher(adminPrincipal, teacherPrincipal.uid, context("Identity reviewed"));
    const suspended = await store.suspendTeacher(adminPrincipal, teacherPrincipal.uid, context("Policy review"));

    expect(approved.roles.teacher).toBe("active");
    expect(approved.activeRole).toBe("teacher");
    expect(suspended.roles.teacher).toBe("suspended");
    expect(suspended.activeRole).toBeNull();
    expect(database.created("auditEvents").map((write) => write.data.action)).toEqual([
      "profile.onboarded",
      "admin.bootstrap",
      "teacher.approved",
      "teacher.suspended",
    ]);
  });

  it("enforces class ownership and supports audited Admin archive and restore transitions", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(otherTeacherPrincipal, { role: "teacher" }, context());
    await store.approveTeacher(adminPrincipal, otherTeacherPrincipal.uid, context("Identity reviewed"));

    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    await expect(store.archive(otherTeacherPrincipal, classroom.id, context("Cross-owner attempt"))).rejects.toMatchObject({ code: "classroom_forbidden" });
    const archived = await store.archive(adminPrincipal, classroom.id, context("Term completed"));
    const restored = await store.restore(adminPrincipal, classroom.id, context("Term reopened"));

    expect(classroom.ownerUid).toBe(teacherPrincipal.uid);
    expect(archived.status).toBe("archived");
    expect(restored.status).toBe("active");
    expect(database.created("auditEvents").slice(-3).map((write) => write.data.action)).toEqual([
      "classroom.created",
      "classroom.archived",
      "classroom.restored",
    ]);
  });

  it("rejects classroom creation by a pending Teacher", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(teacherPrincipal, { role: "teacher" }, context());

    await expect(store.create(teacherPrincipal, { name: "Physics A" }, context())).rejects.toMatchObject({ code: "active_teacher_required" });
    expect(database.created("classrooms")).toHaveLength(0);
  });

  it("rolls back the authoritative write when the create-only audit mirror cannot be created", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    database.failCreateCollection = "auditEvents";

    await expect(store.create(teacherPrincipal, { name: "Physics A" }, context())).rejects.toThrow("injected create failure");

    expect(database.created("classrooms")).toHaveLength(0);
    expect([...database.documents.keys()].some((path) => path.startsWith("classrooms/"))).toBe(false);
  });
});
