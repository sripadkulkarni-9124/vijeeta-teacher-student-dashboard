import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AdminBootstrapConfig, AuditEvent, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AuditEmissionStatus, AuditEmissionStatusReporter, AuditEmitter } from "./audit";
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
    private readonly ordering: ReadonlyArray<{ field: string; direction: "asc" | "desc" }> = [],
    private readonly maximum?: number,
    private readonly cursor?: readonly unknown[],
  ) {}

  where(field: string, operator: "==", value: unknown): FirestoreQuery {
    expect(operator).toBe("==");
    return new FakeQuery(this.database, this.collectionPath, [...this.filters, { field, value }], this.ordering, this.maximum, this.cursor);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.filters, [...this.ordering, { field, direction }], this.maximum, this.cursor);
  }

  limit(maximum: number): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.filters, this.ordering, maximum, this.cursor);
  }

  startAfter(...values: unknown[]): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.filters, this.ordering, this.maximum, values);
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    const prefix = `${this.collectionPath}/`;
    let documents = [...this.database.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) => this.filters.every((filter) => data[filter.field] === filter.value));
    documents = documents.sort((left, right) => this.compareDocuments(left, right));
    if (this.cursor !== undefined) documents = documents.filter((document) => this.compareDocumentToCursor(document) > 0);
    if (this.maximum !== undefined) documents = documents.slice(0, this.maximum);
    return {
      docs: documents.map(([path]) => this.database.snapshot(path)),
    };
  }

  private compareDocuments(left: [string, StoredDocument], right: [string, StoredDocument]): number {
    for (const order of this.ordering) {
      const comparison = String(this.fieldValue(left, order.field)).localeCompare(String(this.fieldValue(right, order.field)));
      if (comparison !== 0) return comparison * (order.direction === "asc" ? 1 : -1);
    }
    return 0;
  }

  private compareDocumentToCursor(document: [string, StoredDocument]): number {
    if (this.cursor === undefined || this.cursor.length !== this.ordering.length) throw new Error("invalid fake query cursor");
    for (const [index, order] of this.ordering.entries()) {
      const comparison = String(this.fieldValue(document, order.field)).localeCompare(String(this.cursor[index]));
      if (comparison !== 0) return comparison * (order.direction === "asc" ? 1 : -1);
    }
    return 0;
  }

  private fieldValue(document: [string, StoredDocument], field: string): unknown {
    return field === "__name__" ? document[0].split("/").at(-1) : document[1][field];
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

class RejectingAuditEmitter implements AuditEmitter {
  attempts = 0;

  async emit(): Promise<void> {
    this.attempts += 1;
    throw new Error("writer rejected password=must-not-surface");
  }
}

class CapturingAuditEmissionStatusReporter implements AuditEmissionStatusReporter {
  readonly statuses: AuditEmissionStatus[] = [];

  async report(status: AuditEmissionStatus): Promise<void> {
    this.statuses.push(structuredClone(status));
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
const BOOTSTRAP_BY_UID: AdminBootstrapConfig = {
  version: 1,
  verifiedEmails: [],
  firebaseUids: ["admin-uid"],
};

const adminPrincipal = principal("admin-uid", "admin@example.com", true);
const teacherPrincipal = principal("teacher-uid", "teacher@example.com", true);
const otherTeacherPrincipal = principal("other-teacher-uid", "other.teacher@example.com", true);
const studentPrincipal = principal("student-uid", "student@example.com", true);

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
      auditEmissionStatusReporter: new CapturingAuditEmissionStatusReporter(),
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
      expect(() => new FirestoreDashboardStore({
        firestore: database,
        databaseId,
        auditEmitter: emitter,
        auditEmissionStatusReporter: new CapturingAuditEmissionStatusReporter(),
      })).toThrow(/vijeeta-dashboard/);
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

  it("rejects an idempotent bootstrap retry when the verified email changed", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP_BY_UID, context());

    await expect(store.bootstrapAdmin(
      principal("admin-uid", "changed.admin@example.com", true),
      BOOTSTRAP_BY_UID,
      context(),
    )).rejects.toMatchObject({ code: "verified_email_changed" });

    expect(database.created("auditEvents")).toHaveLength(1);
    expect(emitter.events).toHaveLength(1);
  });

  it("rejects an idempotent bootstrap retry when its verified-email index is missing or malformed", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    const emailHash = createHash("sha256").update("admin@example.com").digest("hex");
    database.documents.delete(`profileEmailIndex/${emailHash}`);

    await expect(store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context())).rejects.toMatchObject({ code: "email_index_invalid" });

    database.documents.set(`profileEmailIndex/${emailHash}`, {
      firebaseUid: "admin-uid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context())).rejects.toMatchObject({ code: "email_index_invalid" });
    expect(database.created("auditEvents")).toHaveLength(1);
    expect(emitter.events).toHaveLength(1);
  });

  it("rejects an idempotent bootstrap retry when its verified-email index points to another UID", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    const emailHash = createHash("sha256").update("admin@example.com").digest("hex");
    database.documents.set(`profileEmailIndex/${emailHash}`, {
      normalizedEmail: "admin@example.com",
      firebaseUid: "conflicting-admin-uid",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context())).rejects.toMatchObject({ code: "email_index_collision" });
    expect(database.created("auditEvents")).toHaveLength(1);
    expect(emitter.events).toHaveLength(1);
  });

  it("returns a committed bootstrap when canonical emission is deferred and does not duplicate it on retry", async () => {
    const database = new FakeFirestore();
    const emitter = new RejectingAuditEmitter();
    const reporter = new CapturingAuditEmissionStatusReporter();
    let sequence = 0;
    const store = new FirestoreDashboardStore({
      firestore: database,
      databaseId: "vijeeta-dashboard",
      auditEmitter: emitter,
      auditEmissionStatusReporter: reporter,
      randomUuid: () => `generated-${++sequence}`,
      now: () => NOW,
      correlationId: () => CORRELATION_ID,
    });

    const created = await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP);
    const retry = await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP);

    expect(retry.internalProfileId).toBe(created.internalProfileId);
    expect(database.documents.has("profiles/admin-uid")).toBe(true);
    expect(database.created("auditEvents")).toHaveLength(1);
    expect(emitter.attempts).toBe(1);
    expect(reporter.statuses).toEqual([{
      eventId: "generated-2",
      action: "admin.bootstrap",
      status: "deferred",
      category: "canonical_emit_failed",
    }]);
    expect(JSON.stringify(reporter.statuses)).not.toContain("must-not-surface");
  });

  it("paginates profiles with a bounded opaque cursor and no overlap", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    for (const [uid, createdAt] of [
      ["student-a", "2026-08-28T11:00:00.000Z"],
      ["student-b", "2026-08-28T10:00:00.000Z"],
      ["student-c", "2026-08-28T09:00:00.000Z"],
    ] as const) {
      database.documents.set(`profiles/${uid}`, {
        internalProfileId: `profile-${uid}`,
        firebaseUid: uid,
        verifiedEmail: `${uid}@example.com`,
        displayName: uid,
        roles: { student: "active" },
        activeRole: "student",
        onboardingCompleted: true,
        schemaVersion: 2,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const first = await store.listProfiles(adminPrincipal, { limit: 2 });
    expect(first.items.map((profile) => profile.firebaseUid)).toEqual(["student-a", "student-b"]);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("expected profile cursor");
    const second = await store.listProfiles(adminPrincipal, { limit: 2, cursor: first.nextCursor });

    expect(second.items.map((profile) => profile.firebaseUid)).toEqual(["student-c", "admin-uid"]);
    expect(second.nextCursor).toBeNull();
  });

  it("paginates audit events and rejects a cursor issued for another repository", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    for (const [id, createdAt] of [
      ["audit-a", "2026-08-28T11:00:00.000Z"],
      ["audit-b", "2026-08-28T10:00:00.000Z"],
      ["audit-c", "2026-08-28T09:00:00.000Z"],
    ] as const) {
      database.documents.set(`auditEvents/${id}`, {
        id,
        actorUid: "admin-uid",
        actorProfileId: "generated-1",
        action: "teacher.approved",
        targetType: "profile",
        targetId: "teacher-uid",
        reason: "Reviewed eligibility",
        correlationId: CORRELATION_ID,
        canonicalLogInsertId: id,
        createdAt,
      });
    }

    const first = await store.listAuditEvents(adminPrincipal, { limit: 2 });
    expect(first.items.map((event) => event.id)).toEqual(["audit-a", "audit-b"]);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("expected audit cursor");
    const second = await store.listAuditEvents(adminPrincipal, { limit: 2, cursor: first.nextCursor });

    expect(second.items.map((event) => event.id)).toEqual(["audit-c", "generated-2"]);
    expect(second.nextCursor).toBeNull();

    await expect(store.listProfiles(adminPrincipal, {
      limit: 1,
      cursor: first.nextCursor,
    })).rejects.toMatchObject({ code: "pagination_cursor_invalid" });
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

  it("rejects a malformed reverse membership instead of exposing its classroom directly", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set("classrooms/class-a", {
      id: "class-a",
      ownerUid: "teacher-uid",
      name: "Physics A",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    database.documents.set("studentMemberships/student-uid/classes/class-a", {
      classroomId: "class-a",
      studentUid: "student-uid",
      status: "active",
    });

    await expect(store.getClassroom(studentPrincipal, "class-a")).rejects.toMatchObject({ code: "membership_projection_invalid" });
  });

  it("rejects a reverse membership whose embedded class ID differs from its document ID", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set("classrooms/class-b", {
      id: "class-b",
      ownerUid: "teacher-uid",
      name: "Another Teacher Class",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    database.documents.set("studentMemberships/student-uid/classes/class-a", {
      classroomId: "class-b",
      studentUid: "student-uid",
      sourceInviteId: "invite-a",
      status: "active",
      joinedAt: NOW,
      updatedAt: NOW,
    });

    await expect(store.listForPrincipal(studentPrincipal)).rejects.toMatchObject({ code: "membership_projection_invalid" });
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
