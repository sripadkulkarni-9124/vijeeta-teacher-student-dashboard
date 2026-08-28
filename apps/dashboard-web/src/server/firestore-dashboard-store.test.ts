import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AdminBootstrapConfig, AuditEvent, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AuditEmissionStatus, AuditEmissionStatusReporter, AuditEmitter } from "./audit";
import type { MutationContext } from "./dashboard-store";
import {
  FirestoreDashboardStore,
  ADMIN_INVITATION_QUERY_INDEX,
  ASSIGNMENT_RECIPIENT_QUERY_INDEX,
  COLLECTION_GROUP_ID_LOOKUPS,
  STUDENT_ASSIGNMENT_QUERY_INDEX,
  type FirestoreCollectionReference,
  type FirestoreDashboardDocumentReference,
  type FirestoreDashboardDocumentSnapshot,
  type FirestoreDashboardLike,
  type FirestoreDashboardTransaction,
  type FirestoreQuery,
  type FirestoreQuerySnapshot,
} from "./firestore-dashboard-store";

import dashboardIndexes from "../../../../firestore.indexes.dashboard.json";

type StoredDocument = Record<string, unknown>;
type Write =
  | { operation: "create"; path: string; data: StoredDocument }
  | { operation: "set"; path: string; data: StoredDocument }
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
    private readonly scope: "collection" | "group" = "collection",
    private readonly filters: ReadonlyArray<{ field: string; value: unknown }> = [],
    private readonly ordering: ReadonlyArray<{ field: string; direction: "asc" | "desc" }> = [],
    private readonly maximum?: number,
    private readonly cursor?: readonly unknown[],
  ) {}

  where(field: string, operator: "==", value: unknown): FirestoreQuery {
    expect(operator).toBe("==");
    return new FakeQuery(this.database, this.collectionPath, this.scope, [...this.filters, { field, value }], this.ordering, this.maximum, this.cursor);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.scope, this.filters, [...this.ordering, { field, direction }], this.maximum, this.cursor);
  }

  limit(maximum: number): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.scope, this.filters, this.ordering, maximum, this.cursor);
  }

  startAfter(...values: unknown[]): FirestoreQuery {
    return new FakeQuery(this.database, this.collectionPath, this.scope, this.filters, this.ordering, this.maximum, values);
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    const prefix = `${this.collectionPath}/`;
    let documents = [...this.database.documents.entries()]
      .filter(([path]) => this.scope === "collection"
        ? path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
        : path.split("/").at(-2) === this.collectionPath)
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

  collectionGroup(name: string): FirestoreQuery {
    return new FakeQuery(this, name, "group");
  }

  async runTransaction<T>(work: (transaction: FirestoreDashboardTransaction) => Promise<T>): Promise<T> {
    const writes: Write[] = [];
    const transaction: FirestoreDashboardTransaction = {
      get: async (reference) => this.snapshot(reference.path),
      create: (reference, data) => { writes.push({ operation: "create", path: reference.path, data }); },
      set: (reference, data) => { writes.push({ operation: "set", path: reference.path, data }); },
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
      projected.set(write.path, write.operation === "update" ? { ...current, ...structuredClone(write.data) } : structuredClone(write.data));
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
      ref: { path },
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

describe("named dashboard Firestore index contract", () => {
  it("checks in the exact collection-scoped Student assignment pagination index", () => {
    expect(dashboardIndexes.indexes).toContainEqual(STUDENT_ASSIGNMENT_QUERY_INDEX);
    expect(STUDENT_ASSIGNMENT_QUERY_INDEX).toEqual({
      collectionGroup: "assignments",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "classroomId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ],
    });
  });

  it("checks in the assignment recipient and Admin invitation indexes", () => {
    expect(dashboardIndexes.indexes).toContainEqual(ASSIGNMENT_RECIPIENT_QUERY_INDEX);
    expect(dashboardIndexes.indexes).toContainEqual(ADMIN_INVITATION_QUERY_INDEX);
  });

  it("checks in a collection-group index for every id lookup, keeping the collection-scoped ones", () => {
    COLLECTION_GROUP_ID_LOOKUPS.forEach((collectionGroup) => {
      const override = dashboardIndexes.fieldOverrides.find(
        (entry) => entry.collectionGroup === collectionGroup && entry.fieldPath === "id",
      );
      expect(override, `${collectionGroup}.id override`).toBeDefined();
      expect(override!.indexes.some((index) => index.queryScope === "COLLECTION_GROUP")).toBe(true);
      // A field override replaces automatic indexing, so the collection-scoped
      // entries must be restated or ordinary lookups regress.
      expect(override!.indexes.filter((index) => index.queryScope === "COLLECTION").map((index) => index.order).sort())
        .toEqual(["ASCENDING", "DESCENDING"]);
    });
  });
});

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

function seedClassroom(database: FakeFirestore, id: string, updatedAt: string): void {
  database.documents.set(`classrooms/${id}`, {
    id,
    ownerUid: "teacher-uid",
    name: `Class ${id}`,
    status: "active",
    createdAt: updatedAt,
    updatedAt,
  });
}

function seedInvite(
  database: FakeFirestore,
  id: string,
  options: { classroomId?: string; status?: "pending" | "accepted" | "revoked" | "expired"; delivery?: "pending" | "sent" | "failed" | "redelivery_requested" } = {},
): void {
  const classroomId = options.classroomId ?? "class-1";
  const status = options.status ?? "pending";
  const accepted = status === "accepted";
  database.documents.set(`classrooms/${classroomId}/invites/${id}`, {
    id,
    classroomId,
    ownerUid: "teacher-uid",
    normalizedEmail: `${id}@example.test`,
    tokenDigest: id.padEnd(64, "d"),
    tokenVersion: 3,
    expiresAt: "2026-09-04T08:00:00.000Z",
    status,
    delivery: options.delivery ?? "failed",
    ...((options.delivery ?? "failed") === "failed" ? { deliveryErrorCategory: "retryable" } : {}),
    acceptedUid: accepted ? "student-uid" : null,
    acceptedAt: accepted ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  });
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
  // Teacher onboarding is self-serve; no Admin approval step is involved.
  await store.onboard(principalToApprove, { role: "teacher" }, context());
}

describe("FirestoreDashboardStore", () => {
  it("switches only to an already-active role and audits without changing role grants", async () => {
    const database = new FakeFirestore();
    const { store, emitter } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set("profiles/student-uid", {
      ...database.documents.get("profiles/student-uid"),
      roles: { student: "active", teacher: "active", admin: "suspended" },
    });

    const updated = await store.setActiveRole(studentPrincipal, "teacher", context());

    expect(updated).toMatchObject({ activeRole: "teacher", roles: { student: "active", teacher: "active", admin: "suspended" }, updatedAt: NOW });
    expect(database.created("auditEvents").at(-1)?.data).toMatchObject({ action: "profile.active_role_changed", actorUid: "student-uid" });
    expect(emitter.events.at(-1)?.action).toBe("profile.active_role_changed");
  });

  it("rejects ungranted, pending, suspended, and changed-email role switches without writes", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const before = database.committedWrites.length;
    await expect(store.setActiveRole(studentPrincipal, "teacher", context())).rejects.toMatchObject({ code: "role_not_active" });
    database.documents.set("profiles/student-uid", { ...database.documents.get("profiles/student-uid"), roles: { student: "active", teacher: "pending", admin: "suspended" } });
    await expect(store.setActiveRole(studentPrincipal, "teacher", context())).rejects.toMatchObject({ code: "role_not_active" });
    await expect(store.setActiveRole(studentPrincipal, "admin", context())).rejects.toMatchObject({ code: "role_not_active" });
    await expect(store.setActiveRole({ ...studentPrincipal, email: "changed@example.test" }, "student", context())).rejects.toMatchObject({ code: "verified_email_changed" });
    expect(database.committedWrites).toHaveLength(before);
  });

  it("does not change the active role when the immutable audit mirror cannot commit", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set("profiles/student-uid", { ...database.documents.get("profiles/student-uid"), roles: { student: "active", teacher: "active" } });
    database.failCreateCollection = "auditEvents";

    await expect(store.setActiveRole(studentPrincipal, "teacher", context())).rejects.toThrow(/injected create failure/);

    expect(database.documents.get("profiles/student-uid")).toMatchObject({ activeRole: "student" });
  });

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
      set: () => {},
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

  it("reads an historical legacy profile and normalizes it to canonical V2 on bootstrap", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    database.documents.set("profiles/admin-uid", {
      internalProfileId: "legacy-admin-profile",
      firebaseUid: "admin-uid",
      allowedRoles: ["teacher"],
      activeRole: "teacher",
      onboardingCompleted: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(store.getProfile("admin-uid")).resolves.toMatchObject({
      internalProfileId: "legacy-admin-profile",
      roles: { teacher: "pending" },
      activeRole: null,
      schemaVersion: 2,
    });
    const bootstrapped = await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());

    expect(bootstrapped.roles).toEqual({ teacher: "pending", admin: "active" });
    expect(database.documents.get("profiles/admin-uid")).toMatchObject({
      schemaVersion: 2,
      roles: { teacher: "pending", admin: "active" },
      activeRole: "admin",
    });
    expect(database.documents.get("profiles/admin-uid")).not.toHaveProperty("allowedRoles");
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

  it("paginates every classroom for an active multi-role Admin independently of activeRole", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    database.documents.set("profiles/admin-uid", {
      ...database.documents.get("profiles/admin-uid"),
      roles: { admin: "active", teacher: "active" },
      activeRole: "teacher",
    });
    for (let index = 0; index < 105; index += 1) {
      seedClassroom(
        database,
        `class-${String(index).padStart(3, "0")}`,
        new Date(Date.parse("2026-08-28T12:00:00.000Z") - index * 1_000).toISOString(),
      );
    }

    const first = await store.listClassrooms(adminPrincipal, { limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.id).toBe("class-000");
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("expected classroom cursor");
    const second = await store.listClassrooms(adminPrincipal, { limit: 100, cursor: first.nextCursor });

    expect(second.items.map((item) => item.id)).toEqual([
      "class-100", "class-101", "class-102", "class-103", "class-104",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists and resolves invitations by server-side ID only for an active Admin", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    seedInvite(database, "invite-a", { classroomId: "class-a" });
    seedInvite(database, "invite-b", { classroomId: "class-b", delivery: "pending" });

    const page = await store.listInvitations(adminPrincipal, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    if (page.nextCursor === null) throw new Error("expected invitation cursor");
    const nextPage = await store.listInvitations(adminPrincipal, { limit: 1, cursor: page.nextCursor });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(nextPage.nextCursor).toBeNull();
    await expect(store.getInvitationById(adminPrincipal, "invite-a")).resolves.toMatchObject({
      id: "invite-a", classroomId: "class-a",
    });
    await expect(store.getInvitationById(adminPrincipal, "missing")).resolves.toBeNull();
    await expect(store.getInvitationById(teacherPrincipal, "invite-a")).rejects.toMatchObject({ code: "admin_required" });

    seedInvite(database, "invite-a", { classroomId: "class-c" });
    await expect(store.getInvitationById(adminPrincipal, "invite-a")).rejects.toMatchObject({ code: "invitation_identity_collision" });
  });

  it("revokes only pending invitations and writes the audit mirror atomically", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    seedInvite(database, "invite-revoke", { classroomId: "class-a" });
    seedInvite(database, "invite-accepted", { classroomId: "class-b", status: "accepted", delivery: "sent" });

    const revoked = await store.revokeInvitationById(adminPrincipal, "invite-revoke", context("Recipient withdrawn"));
    expect(revoked.status).toBe("revoked");
    expect(database.created("auditEvents").at(-1)?.data).toMatchObject({
      action: "invite.revoked", targetId: "invite-revoke", reason: "Recipient withdrawn",
    });
    await expect(store.revokeInvitationById(adminPrincipal, "missing", context("Withdraw"))).rejects.toMatchObject({ code: "invitation_not_found" });
    await expect(store.revokeInvitationById(adminPrincipal, "invite-accepted", context("Withdraw"))).rejects.toMatchObject({ code: "invitation_transition_invalid" });
  });

  it("records redelivery intent without rotating secrets or claiming delivery", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    seedInvite(database, "invite-redelivery", { classroomId: "class-a" });
    const before = structuredClone(database.documents.get("classrooms/class-a/invites/invite-redelivery"));

    const requested = await store.requestInvitationRedelivery(
      adminPrincipal,
      "invite-redelivery",
      context("Recipient requested a fresh link"),
    );

    expect(requested).toMatchObject({ delivery: "redelivery_requested", tokenVersion: 3, deliveryErrorCategory: null });
    expect(requested.tokenDigest).toBe(before?.tokenDigest);
    expect(database.created("auditEvents").at(-1)?.data).toMatchObject({
      action: "invite.redelivery_requested", targetId: "invite-redelivery",
    });
    await expect(store.requestInvitationRedelivery(
      adminPrincipal,
      "invite-redelivery",
      context("Duplicate request"),
    )).rejects.toMatchObject({ code: "invitation_transition_invalid" });
  });

  it("rolls back an invitation transition when its audit mirror cannot be created", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    seedInvite(database, "invite-audit-failure", { classroomId: "class-a" });
    database.failCreateCollection = "auditEvents";

    await expect(store.revokeInvitationById(
      adminPrincipal,
      "invite-audit-failure",
      context("Recipient withdrawn"),
    )).rejects.toThrow("injected create failure");

    expect(database.documents.get("classrooms/class-a/invites/invite-audit-failure")).toMatchObject({
      status: "pending", delivery: "failed",
    });
  });

  it("creates an active Teacher profile and a hashed verified-email index in one transaction", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);

    const profile = await store.onboard(teacherPrincipal, { role: "teacher" }, context());

    const emailHash = createHash("sha256").update("teacher@example.com").digest("hex");
    expect(profile.roles).toEqual({ teacher: "active" });
    expect(profile.activeRole).toBe("teacher");
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

  it("allows only an active Admin to suspend a Teacher and restore them, with audited reasons", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(teacherPrincipal, { role: "teacher" }, context());

    await expect(store.suspendTeacher(otherTeacherPrincipal, teacherPrincipal.uid, context("Forged suspension"))).rejects.toMatchObject({ code: "admin_required" });
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    const suspended = await store.suspendTeacher(adminPrincipal, teacherPrincipal.uid, context("Policy review"));
    const restored = await store.approveTeacher(adminPrincipal, teacherPrincipal.uid, context("Review cleared"));

    expect(suspended.roles.teacher).toBe("suspended");
    expect(suspended.activeRole).toBeNull();
    expect(restored.roles.teacher).toBe("active");
    expect(restored.activeRole).toBe("teacher");
    expect(database.created("auditEvents").map((write) => write.data.action)).toEqual([
      "profile.onboarded",
      "admin.bootstrap",
      "teacher.suspended",
      "teacher.approved",
    ]);
  });

  it("enforces class ownership and supports audited Admin archive and restore transitions", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(otherTeacherPrincipal, { role: "teacher" }, context());

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

  it("denies owner-route archive authority to a multi-role Admin+Teacher for another Teacher's class", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    database.documents.set("profiles/admin-uid", {
      ...database.documents.get("profiles/admin-uid"), roles: { admin: "active", teacher: "active" }, activeRole: "teacher",
    });
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());

    await expect(store.archiveOwned(adminPrincipal, classroom.id, context("Forged owner archive"))).rejects.toMatchObject({ code: "classroom_forbidden" });
    expect(database.documents.get(`classrooms/${classroom.id}`)).toMatchObject({ status: "active" });
  });

  it("rejects classroom creation by a Teacher who is not active", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    // Onboarding is self-serve, so suspension is how a Teacher loses authority.
    await store.suspendTeacher(adminPrincipal, teacherPrincipal.uid, context("Policy review"));

    await expect(store.create(teacherPrincipal, { name: "Physics A" }, context())).rejects.toMatchObject({ code: "active_teacher_required" });
    expect(database.created("classrooms")).toHaveLength(0);
  });

  it("replays class creation idempotently for the same verified actor and correlation key", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);

    const first = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const replay = await store.create(teacherPrincipal, { name: "Physics A" }, context());

    expect(replay).toEqual(first);
    await expect(store.create(teacherPrincipal, { name: "Chemistry A" }, context())).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(database.created("classrooms")).toHaveLength(1);
    expect([...database.documents.values()].filter((document) => document.action === "classroom.created")).toHaveLength(1);
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

  it("persists invitation and delivery attempts without creating membership, then accepts atomically and idempotently", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-flow", classroomId: classroom.id, normalizedEmail: "student@example.com",
      tokenDigest: "d".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());

    expect(invite).toMatchObject({ status: "pending", delivery: "pending" });
    expect([...database.documents.keys()].some((path) => path.includes("/members/"))).toBe(false);
    const attempt = await store.beginInvitationDelivery(teacherPrincipal, classroom.id, invite.id, "capture", {
      tokenDigest: invite.tokenDigest,
      tokenVersion: invite.tokenVersion,
    }, context());
    const sent = await store.completeInvitationDelivery(teacherPrincipal, classroom.id, invite.id, attempt.attemptId, {
      status: "sent", provider: "capture", providerMessageId: "<attempt@example.test>",
    }, context());
    expect(sent.delivery).toBe("sent");
    expect([...database.documents.keys()].some((path) => path.includes("/members/"))).toBe(false);

    const accepted = await store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context());
    const replay = await store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context());
    expect(replay).toEqual(accepted);
    expect(database.documents.get(`classrooms/${classroom.id}/members/student-uid`)).toEqual(accepted);
    expect(database.documents.get(`studentMemberships/student-uid/classes/${classroom.id}`)).toEqual(accepted);
    expect([...database.documents.values()].filter((document) => document.action === "invite.accepted")).toHaveLength(1);
  });

  it("replays invitation creation without duplicating a token record for the same correlation key", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const first = await store.createInvitation(teacherPrincipal, {
      id: "invite-first", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "f".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    const replay = await store.createInvitation(teacherPrincipal, {
      id: "invite-retry", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "n".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());

    expect(first).toMatchObject({ disposition: "created" });
    expect(replay).toMatchObject({ disposition: "idempotent_replay", invite: first.invite });
    expect(database.created("invites")).toHaveLength(1);
    expect([...database.documents.values()].filter((document) => document.action === "invite.created")).toHaveLength(1);
    await expect(store.createInvitation(teacherPrincipal, {
      id: "invite-conflict", classroomId: classroom.id, normalizedEmail: "other@example.com", tokenDigest: "x".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context())).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("fails invitation identity, ownership, archive, and rate-limit checks without transport or membership side effects", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await activeTeacher(store, otherTeacherPrincipal);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());

    await expect(store.createInvitation(otherTeacherPrincipal, {
      id: "cross-owner", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "x".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context())).rejects.toMatchObject({ code: "classroom_forbidden" });

    for (let index = 0; index < 5; index += 1) {
      await store.createInvitation(teacherPrincipal, {
        id: `invite-rate-${index}`, classroomId: classroom.id, normalizedEmail: "rate@example.com", tokenDigest: String(index).padEnd(64, "d"), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
      }, { ...context(), correlationId: `123e4567-e89b-12d3-a456-${String(index).padStart(12, "0")}` });
    }
    await expect(store.createInvitation(teacherPrincipal, {
      id: "invite-rate-denied", classroomId: classroom.id, normalizedEmail: "rate@example.com", tokenDigest: "z".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, { ...context(), correlationId: "123e4567-e89b-12d3-a456-999999999999" })).rejects.toMatchObject({ code: "rate_limited" });
    expect(database.documents.has(`classrooms/${classroom.id}/invites/invite-rate-denied`)).toBe(false);

    await store.archive(teacherPrincipal, classroom.id, context("Term ended"));
    await expect(store.createInvitation(teacherPrincipal, {
      id: "archived-invite", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "a".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, { ...context(), correlationId: "123e4567-e89b-12d3-a456-888888888888" })).rejects.toMatchObject({ code: "classroom_archived" });
  });

  it("rotates pending invitations before redelivery and rejects stale compare inputs", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-rotate", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "o".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    const rotated = await store.rotateInvitation(teacherPrincipal, {
      id: invite.id, classroomId: classroom.id, normalizedEmail: invite.normalizedEmail, tokenDigest: "n".repeat(64), tokenVersion: 2, expiresAt: "2026-09-05T08:00:00.000Z",
    }, context());
    expect(rotated).toMatchObject({ disposition: "rotated", invite: { tokenDigest: "n".repeat(64), tokenVersion: 2, delivery: "pending" } });
    const replay = await store.rotateInvitation(teacherPrincipal, {
      id: invite.id, classroomId: classroom.id, normalizedEmail: invite.normalizedEmail, tokenDigest: "x".repeat(64), tokenVersion: 3, expiresAt: "2026-09-06T08:00:00.000Z",
    }, context());
    expect(replay).toMatchObject({ disposition: "idempotent_replay", invite: rotated.invite });

    await expect(store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context())).rejects.toMatchObject({ code: "invitation_invalid" });
    expect(database.documents.has(`classrooms/${classroom.id}/members/student-uid`)).toBe(false);
  });

  it("binds a delivery attempt to the exact persisted token digest and version", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const created = await store.createInvitation(teacherPrincipal, {
      id: "invite-bound", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "b".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());

    await expect(store.beginInvitationDelivery(teacherPrincipal, classroom.id, created.invite.id, "capture", {
      tokenDigest: "x".repeat(64), tokenVersion: 1,
    }, context())).rejects.toMatchObject({ code: "invitation_transition_invalid" });
    expect([...database.documents.keys()].some((path) => path.includes("deliveryAttempts"))).toBe(false);
  });

  it("rejects expired and changed-Teacher-email redelivery without mutation", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite: expired } = await store.createInvitation(teacherPrincipal, {
      id: "invite-expired-redelivery", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "e".repeat(64), tokenVersion: 1, expiresAt: "2026-08-28T08:00:01.000Z",
    }, context());
    await expect(store.rotateInvitation(teacherPrincipal, {
      id: expired.id, classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "n".repeat(64), tokenVersion: 2, expiresAt: "2026-09-04T08:00:00.000Z",
    }, { ...context(), now: "2026-08-28T08:00:02.000Z" })).rejects.toMatchObject({ code: "invitation_transition_invalid" });

    database.documents.set("profiles/teacher-uid", { ...database.documents.get("profiles/teacher-uid"), verifiedEmail: "changed@example.com" });
    await expect(store.rotateInvitation(teacherPrincipal, {
      id: expired.id, classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "z".repeat(64), tokenVersion: 2, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context())).rejects.toMatchObject({ code: "verified_email_changed" });
    expect(database.documents.get(`classrooms/${classroom.id}/invites/${expired.id}`)).toMatchObject({ tokenVersion: 1, tokenDigest: "e".repeat(64) });
  });

  it.each(["sent", "failed", "unknown"] as const)("records %s after suspension and archive race from the committed owner-bound attempt", async (status) => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const created = await store.createInvitation(teacherPrincipal, {
      id: `invite-race-${status}`, classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: status.padEnd(64, "d"), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    const attempt = await store.beginInvitationDelivery(teacherPrincipal, classroom.id, created.invite.id, "capture", {
      tokenDigest: created.invite.tokenDigest, tokenVersion: created.invite.tokenVersion,
    }, context());
    await store.suspendTeacher(adminPrincipal, teacherPrincipal.uid, context("Safety suspension"));
    await store.archive(adminPrincipal, classroom.id, context("Safety archive"));

    const completed = await store.completeInvitationDelivery(teacherPrincipal, classroom.id, created.invite.id, attempt.attemptId, {
      status,
      provider: "capture",
      ...(status === "sent" ? { providerMessageId: "<race@vijeeta.com>" } : status === "failed" ? { category: "transport_pre_data" as const, retryable: true } : { category: "delivery_ambiguous" as const, retryable: false }),
    }, context());
    expect(completed.delivery).toBe(status);
  });

  it("fails a valid reverse membership closed when its target classroom is missing", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set("studentMemberships/student-uid/classes/missing-class", {
      classroomId: "missing-class", studentUid: "student-uid", sourceInviteId: "invite-a", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    await expect(store.listForPrincipalPage(studentPrincipal, { limit: 25 })).rejects.toMatchObject({ code: "membership_projection_invalid" });
  });

  it("rejects collection-group invite data whose physical parent differs from embedded classroom identity", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await store.bootstrapAdmin(adminPrincipal, BOOTSTRAP, context());
    seedInvite(database, "invite-parent", { classroomId: "physical-class" });
    database.documents.set("classrooms/physical-class/invites/invite-parent", {
      ...database.documents.get("classrooms/physical-class/invites/invite-parent"), classroomId: "embedded-class",
    });
    await expect(store.getInvitationById(adminPrincipal, "invite-parent")).rejects.toMatchObject({ code: "invitation_identity_collision" });
  });

  it("returns an owner-only redacted roster and rolls acceptance back when its audit mirror fails", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await activeTeacher(store, otherTeacherPrincipal);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-roster", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "r".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    const roster = await store.listRoster(teacherPrincipal, classroom.id, { limit: 25 });
    expect(roster.invitations[0]).toMatchObject({ id: invite.id, maskedEmail: "s***@example.com" });
    expect(JSON.stringify(roster)).not.toContain("student@example.com");
    expect(JSON.stringify(roster)).not.toContain("r".repeat(64));
    await expect(store.listRoster(otherTeacherPrincipal, classroom.id, { limit: 25 })).rejects.toMatchObject({ code: "classroom_forbidden" });

    database.failCreateCollection = "auditEvents";
    await expect(store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context())).rejects.toThrow("injected create failure");
    expect(database.documents.has(`classrooms/${classroom.id}/members/student-uid`)).toBe(false);
    expect(database.documents.has(`studentMemberships/student-uid/classes/${classroom.id}`)).toBe(false);
    expect(database.documents.get(`classrooms/${classroom.id}/invites/${invite.id}`)).toMatchObject({ status: "pending" });
  });

  it("fails inspect and acceptance closed for wrong, unverified, missing-Student, expired, and revoked identities", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const noStudent = principal("no-student", "student@example.com", true);
    await store.onboard(noStudent, { role: "teacher" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-hostile", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "h".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());

    await expect(store.inspectInvitation(principal("wrong", "wrong@example.com", true), invite.id)).rejects.toMatchObject({ code: "invitation_invalid" });
    await expect(store.inspectInvitation(principal("unverified", "student@example.com", false), invite.id)).rejects.toMatchObject({ code: "verified_email_required" });
    database.documents.set("profiles/changed-email", {
      internalProfileId: "profile-changed", firebaseUid: "changed-email", verifiedEmail: "old@example.com", displayName: "Changed",
      roles: { student: "active" }, activeRole: "student", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
    });
    await expect(store.inspectInvitation(principal("changed-email", "student@example.com", true), invite.id)).rejects.toMatchObject({ code: "invitation_invalid" });
    await expect(store.acceptInvitation(noStudent, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context())).rejects.toMatchObject({ code: "student_role_required" });

    await store.revokeInvitation(teacherPrincipal, classroom.id, invite.id, context("Recipient removed"));
    await expect(store.inspectInvitation(studentPrincipal, invite.id)).rejects.toMatchObject({ code: "invitation_invalid" });
    expect(database.documents.has(`classrooms/${classroom.id}/members/student-uid`)).toBe(false);

    database.documents.set("profiles/no-student", {
      ...database.documents.get("profiles/no-student"),
      roles: { teacher: "pending", student: "active" },
      activeRole: "student",
    });

    const { invite: expired } = await store.createInvitation(teacherPrincipal, {
      id: "invite-expired", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "e".repeat(64), tokenVersion: 1, expiresAt: "2026-08-28T08:00:01.000Z",
    }, context());
    await expect(store.acceptInvitation(noStudent, {
      classroomId: classroom.id, invitationId: expired.id, expectedTokenDigest: expired.tokenDigest, expectedTokenVersion: 1,
    }, { ...context(), now: "2026-08-28T08:00:02.000Z" })).rejects.toMatchObject({ code: "invitation_invalid" });
  });

  it("allows one concurrent invitation acceptance winner and preserves a consistent idempotent replay", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-concurrent", classroomId: classroom.id, normalizedEmail: "student@example.com", tokenDigest: "c".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    const input = { classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1 };

    const results = await Promise.allSettled([
      store.acceptInvitation(studentPrincipal, input, context()),
      store.acceptInvitation(studentPrincipal, input, context()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(store.acceptInvitation(studentPrincipal, input, context())).resolves.toMatchObject({ studentUid: "student-uid" });
    expect([...database.documents.values()].filter((document) => document.action === "invite.accepted")).toHaveLength(1);
  });

  it("snapshots verified active members once, claims one V3 write, and completes after Teacher suspension", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-assignment", classroomId: classroom.id, normalizedEmail: "student@example.com",
      tokenDigest: "a".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    await store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context());

    const input = { classroomId: classroom.id, idempotencyKey: CORRELATION_ID, request: {
      jobId: "job-1", openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close" as const,
    } };
    const first = await store.prepareAssignment(teacherPrincipal, input, context());
    const replay = await store.prepareAssignment(teacherPrincipal, input, context());
    expect(first.disposition).toBe("created");
    expect(replay).toMatchObject({ disposition: "idempotent_replay", assignment: { id: first.assignment.id } });
    expect(first.assignment.recipientSnapshot).toEqual([{ uid: "student-uid", email: "student@example.com" }]);

    const claimed = await store.claimAssignmentShare(teacherPrincipal, first.assignment.id, context());
    expect(claimed).toMatchObject({ status: "claimed", assignment: { state: "reconciliation_required" } });
    const competing = await store.claimAssignmentShare(teacherPrincipal, first.assignment.id, context());
    expect(competing).toMatchObject({ status: "already_claimed", assignment: { state: "reconciliation_required" } });
    const second = await store.prepareAssignment(teacherPrincipal, {
      ...input, idempotencyKey: "123e4567-e89b-12d3-a456-426614174001", request: { ...input.request, jobId: "job-2" },
    }, { ...context(), correlationId: "123e4567-e89b-12d3-a456-426614174001" });
    const firstPage = await store.listAssignmentsForPrincipalPage(teacherPrincipal, classroom.id, { limit: 1 });
    const secondPage = await store.listAssignmentsForPrincipalPage(teacherPrincipal, classroom.id, { limit: 1, cursor: firstPage.nextCursor! });
    expect(new Set([...firstPage.items, ...secondPage.items].map((assignment) => assignment.id))).toEqual(new Set([first.assignment.id, second.assignment.id]));
    const studentFirstPage = await store.listAssignmentsForPrincipalPage(studentPrincipal, classroom.id, { limit: 1 });
    const studentSecondPage = await store.listAssignmentsForPrincipalPage(studentPrincipal, classroom.id, { limit: 1, cursor: studentFirstPage.nextCursor! });
    expect(new Set([...studentFirstPage.items, ...studentSecondPage.items].map((assignment) => assignment.id))).toEqual(new Set([first.assignment.id, second.assignment.id]));
    expect(database.documents.get(`studentAssignments/student-uid/assignments/${first.assignment.id}`)).toMatchObject({
      assignmentId: first.assignment.id, classroomId: classroom.id, studentUid: "student-uid",
    });
    await store.suspendTeacher(adminPrincipal, teacherPrincipal.uid, context("Teacher suspended"));
    if (claimed.status !== "claimed") throw new Error("expected assignment claim");
    const completed = await store.completeAssignmentShare(teacherPrincipal, first.assignment.id, claimed.operationId, {
      kind: "active", shareId: "share-1", testId: "test-1", runnerPath: "/t/abcdefghijklmnop",
    }, context());
    expect(completed).toMatchObject({ state: "active", shareId: "share-1", testId: "test-1" });
    database.documents.set("profiles/teacher-uid", {
      ...database.documents.get("profiles/teacher-uid"), roles: { teacher: "active" }, activeRole: "teacher",
    });
    await expect(store.claimAssignmentShare(teacherPrincipal, first.assignment.id, context())).resolves.toMatchObject({
      status: "already_claimed", assignment: { state: "active" },
    });
    expect([...database.documents.values()].filter((document) => document.action === "assignment.created")).toHaveLength(2);
    expect([...database.documents.values()].filter((document) => document.action === "assignment.activated")).toHaveLength(1);
  });

  it("keeps historical Student snapshot authority after membership suspension and denies non-recipients", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-history", classroomId: classroom.id, normalizedEmail: "student@example.com",
      tokenDigest: "b".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    await store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context());
    const prepared = await store.prepareAssignment(teacherPrincipal, { classroomId: classroom.id, idempotencyKey: CORRELATION_ID, request: {
      jobId: "job-1", openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close",
    } }, context());
    database.documents.set(`classrooms/${classroom.id}/assignments/${prepared.assignment.id}/outboundOperations/v3-share`, {
      id: "operation-crash", assignmentId: prepared.assignment.id, classroomId: classroom.id,
      ownerUid: "teacher-uid", ownerProfileId: database.documents.get("profiles/teacher-uid")?.internalProfileId,
      status: "claimed", createdAt: NOW, updatedAt: NOW,
    });
    await expect(store.claimAssignmentShare(teacherPrincipal, prepared.assignment.id, context())).resolves.toMatchObject({
      status: "already_claimed", assignment: { state: "reconciliation_required" },
    });
    database.documents.set(`classrooms/${classroom.id}/members/student-uid`, {
      ...database.documents.get(`classrooms/${classroom.id}/members/student-uid`), status: "suspended",
    });
    database.documents.set(`studentMemberships/student-uid/classes/${classroom.id}`, {
      ...database.documents.get(`studentMemberships/student-uid/classes/${classroom.id}`), status: "suspended",
    });
    await expect(store.prepareAssignment(teacherPrincipal, { classroomId: classroom.id, idempotencyKey: CORRELATION_ID, request: {
      jobId: "job-1", openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close",
    } }, context())).resolves.toMatchObject({ disposition: "idempotent_replay", assignment: { id: prepared.assignment.id } });
    await expect(store.getAssignmentForStudent(studentPrincipal, prepared.assignment.id)).resolves.toMatchObject({ id: prepared.assignment.id });
    const outsider = principal("outsider-uid", "outsider@example.com", true);
    await store.onboard(outsider, { role: "student" }, { ...context(), correlationId: "123e4567-e89b-12d3-a456-426614174001" });
    await expect(store.getAssignmentForStudent(outsider, prepared.assignment.id)).rejects.toMatchObject({ code: "assignment_forbidden" });
  });

  it("uses only activeRole for multi-role assignment listing and fails malformed reverse projections closed", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    await store.onboard(studentPrincipal, { role: "student" }, context());
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const { invite } = await store.createInvitation(teacherPrincipal, {
      id: "invite-role", classroomId: classroom.id, normalizedEmail: "student@example.com",
      tokenDigest: "m".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
    }, context());
    await store.acceptInvitation(studentPrincipal, {
      classroomId: classroom.id, invitationId: invite.id, expectedTokenDigest: invite.tokenDigest, expectedTokenVersion: 1,
    }, context());
    const visible = await store.prepareAssignment(teacherPrincipal, {
      classroomId: classroom.id, idempotencyKey: CORRELATION_ID,
      request: { jobId: "job-visible", openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close" },
    }, context());
    database.documents.set(`classrooms/${classroom.id}/assignments/owner-only`, {
      ...visible.assignment, id: "owner-only", jobId: "job-owner", recipientSnapshot: [{ uid: "other-student", email: "other@example.com" }],
    });
    database.documents.set("profiles/teacher-uid", {
      ...database.documents.get("profiles/teacher-uid"), roles: { teacher: "active", student: "active" }, activeRole: "student",
    });
    database.documents.set(`classrooms/${classroom.id}/members/teacher-uid`, {
      classroomId: classroom.id, studentUid: "teacher-uid", sourceInviteId: "invite-teacher", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    database.documents.set(`studentMemberships/teacher-uid/classes/${classroom.id}`, {
      classroomId: classroom.id, studentUid: "teacher-uid", sourceInviteId: "invite-teacher", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    await expect(store.listAssignmentsForPrincipalPage(teacherPrincipal, classroom.id, { limit: 20 })).resolves.toMatchObject({ items: [] });

    database.documents.set("profiles/teacher-uid", { ...database.documents.get("profiles/teacher-uid"), activeRole: "teacher" });
    const teacherView = await store.listAssignmentsForPrincipalPage(teacherPrincipal, classroom.id, { limit: 20 });
    expect(teacherView.items.map((assignment) => assignment.id)).toContain("owner-only");

    await activeTeacher(store, otherTeacherPrincipal);
    database.documents.set("profiles/other-teacher-uid", {
      ...database.documents.get("profiles/other-teacher-uid"), roles: { teacher: "active", student: "active" }, activeRole: "teacher",
    });
    database.documents.set(`classrooms/${classroom.id}/members/other-teacher-uid`, {
      classroomId: classroom.id, studentUid: "other-teacher-uid", sourceInviteId: "invite-other", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    database.documents.set(`studentMemberships/other-teacher-uid/classes/${classroom.id}`, {
      classroomId: classroom.id, studentUid: "other-teacher-uid", sourceInviteId: "invite-other", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    await expect(store.listAssignmentsForPrincipalPage(otherTeacherPrincipal, classroom.id, { limit: 20 })).rejects.toMatchObject({ code: "assignment_forbidden" });

    database.documents.set(`studentAssignments/student-uid/assignments/${visible.assignment.id}`, {
      ...database.documents.get(`studentAssignments/student-uid/assignments/${visible.assignment.id}`), ownerUid: "wrong-owner",
    });
    await expect(store.listAssignmentsForPrincipalPage(studentPrincipal, classroom.id, { limit: 20 })).rejects.toMatchObject({ code: "assignment_projection_invalid" });
    database.documents.set(`studentAssignments/student-uid/assignments/${visible.assignment.id}`, {
      assignmentId: visible.assignment.id, classroomId: classroom.id, studentUid: "student-uid",
      ownerUid: "teacher-uid", createdAt: NOW, updatedAt: NOW,
    });
    database.documents.delete(`classrooms/${classroom.id}/assignments/${visible.assignment.id}`);
    await expect(store.listAssignmentsForPrincipalPage(studentPrincipal, classroom.id, { limit: 20 })).rejects.toMatchObject({ code: "assignment_projection_invalid" });
  });

  it("fails global assignment lookup closed for duplicate or physically inconsistent IDs", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const assignment = {
      id: "duplicate-assignment", classroomId: "class-a", ownerUid: "teacher-uid", jobId: "job-1",
      recipientSnapshot: [{ uid: "student-uid", email: "student@example.com" }],
      openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close",
      state: "creating", testId: null, shareId: null, runnerPath: null, reconciliation: null, createdAt: NOW, updatedAt: NOW,
    };
    database.documents.set("classrooms/class-a/assignments/duplicate-assignment", assignment);
    database.documents.set("classrooms/class-b/assignments/duplicate-assignment", { ...assignment, classroomId: "class-b" });
    await expect(store.getOwnedAssignment(teacherPrincipal, "duplicate-assignment")).rejects.toMatchObject({ code: "assignment_identity_collision" });
    database.documents.delete("classrooms/class-b/assignments/duplicate-assignment");
    database.documents.set("classrooms/class-a/assignments/duplicate-assignment", { ...assignment, classroomId: "wrong-parent" });
    await expect(store.getOwnedAssignment(teacherPrincipal, "duplicate-assignment")).rejects.toMatchObject({ code: "assignment_identity_collision" });
  });

  it("rejects empty classrooms, noncanonical schedules, and malformed verified recipient indexes before assignment creation", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    await activeTeacher(store);
    const classroom = await store.create(teacherPrincipal, { name: "Physics A" }, context());
    const base = { classroomId: classroom.id, idempotencyKey: CORRELATION_ID, request: {
      jobId: "job-1", openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close" as const,
    } };
    await expect(store.prepareAssignment(teacherPrincipal, base, context())).rejects.toMatchObject({ code: "assignment_recipients_unavailable" });
    await expect(store.prepareAssignment(teacherPrincipal, { ...base, request: { ...base.request, openAt: "2026-08-28T07:00:00.500Z" } }, context())).rejects.toThrow();

    for (let index = 0; index < 498; index += 1) {
      const uid = `bulk-student-${String(index).padStart(3, "0")}`;
      database.documents.set(`classrooms/${classroom.id}/members/${uid}`, {
        classroomId: classroom.id, studentUid: uid, sourceInviteId: "bulk-invite", status: "active", joinedAt: NOW, updatedAt: NOW,
      });
    }
    await expect(store.prepareAssignment(teacherPrincipal, base, context())).rejects.toMatchObject({ code: "assignment_recipients_unavailable" });
    for (const path of [...database.documents.keys()]) {
      if (path.startsWith(`classrooms/${classroom.id}/members/bulk-student-`)) database.documents.delete(path);
    }

    await store.onboard(studentPrincipal, { role: "student" }, context());
    database.documents.set(`classrooms/${classroom.id}/members/student-uid`, {
      classroomId: classroom.id, studentUid: "student-uid", sourceInviteId: "invite-1", status: "active", joinedAt: NOW, updatedAt: NOW,
    });
    database.documents.delete(`profileEmailIndex/${createHash("sha256").update("student@example.com").digest("hex")}`);
    await expect(store.prepareAssignment(teacherPrincipal, base, context())).rejects.toMatchObject({ code: "assignment_recipients_unavailable" });
    expect(database.created("assignments")).toHaveLength(0);
  });
});

describe("legacy profile documents never bypass Teacher approval", () => {
  const legacyDocument = (overrides: Record<string, unknown> = {}) => ({
    internalProfileId: "legacy-profile",
    firebaseUid: "legacy-uid",
    allowedRoles: ["teacher"],
    activeRole: "teacher",
    onboardingCompleted: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  it("maps a legacy teacher entitlement to pending, so an unapproved Teacher cannot act", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    database.documents.set("profiles/legacy-uid", legacyDocument());

    await expect(store.getProfile("legacy-uid")).resolves.toMatchObject({
      roles: { teacher: "pending" },
      activeRole: null,
    });
  });

  it("keeps a legacy student entitlement active, because Student needs no approval", async () => {
    const database = new FakeFirestore();
    const { store } = storeFor(database);
    database.documents.set("profiles/legacy-uid", legacyDocument({ allowedRoles: ["student"], activeRole: "student" }));

    await expect(store.getProfile("legacy-uid")).resolves.toMatchObject({
      roles: { student: "active" },
      activeRole: "student",
    });
  });
});
