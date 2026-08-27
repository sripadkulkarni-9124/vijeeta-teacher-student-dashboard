import { createHash, randomUUID } from "node:crypto";

import {
  AdminBootstrapConfigSchema,
  AuditEventSchema,
  ClassroomInviteSchema,
  ClassroomMembershipSchema,
  ClassroomRosterResponseSchema,
  ClassroomSchema,
  CreateClassroomRequestSchema,
  DashboardProfileOnboardRequestSchema,
  DashboardProfileSchema,
  DashboardProfileV2Schema,
  PaginationRequestSchema,
  VerifiedPrincipalSchema,
  type AdminBootstrapConfig,
  type AuditAction,
  type AuditEvent,
  type Classroom,
  type ClassroomInvite,
  type ClassroomMembership,
  type ClassroomRosterResponse,
  type CreateClassroomRequest,
  type DashboardProfileOnboardRequest,
  type DashboardProfileV2,
  type PaginationRequest,
  type RedactedAuditChangeSet,
  type VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import { matchesAdminBootstrap } from "./admin-bootstrap";
import type { AuditEmissionStatusReporter, AuditEmitter } from "./audit";
import {
  DashboardStoreError,
  type AdminRepository,
  type AdminClassroomRepository,
  type AdminInvitationRepository,
  type AuditRepository,
  type CreateInvitationInput,
  type InvitationAcceptanceInput,
  type InvitationDeliveryOutcome,
  type InvitationDispatch,
  type InvitationInspection,
  type InvitationCreationResult,
  type InvitationRepository,
  type InvitationRotationResult,
  type InvitationTokenBinding,
  type MutationContext,
  type Page,
  type PaginatedClassroomRepository,
  type ProfileRepository,
  type RosterPagination,
} from "./dashboard-store";

const DASHBOARD_DATABASE_ID = "vijeeta-dashboard";
const MAX_PAGE_SIZE = 100;

export interface FirestoreDashboardDocumentSnapshot {
  id: string;
  exists: boolean;
  readonly ref: { readonly path: string };
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreQuerySnapshot {
  docs: FirestoreDashboardDocumentSnapshot[];
}

export interface FirestoreQuery {
  where(field: string, operator: "==", value: unknown): FirestoreQuery;
  orderBy(field: string, direction?: "asc" | "desc"): FirestoreQuery;
  limit(maximum: number): FirestoreQuery;
  startAfter(...values: unknown[]): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreCollectionReference extends FirestoreQuery {
  readonly path: string;
  doc(id: string): FirestoreDashboardDocumentReference;
}

export interface FirestoreDashboardDocumentReference {
  readonly id: string;
  readonly path: string;
  collection(name: string): FirestoreCollectionReference;
  get(): Promise<FirestoreDashboardDocumentSnapshot>;
}

export interface FirestoreDashboardTransaction {
  get(reference: FirestoreDashboardDocumentReference): Promise<FirestoreDashboardDocumentSnapshot>;
  create(reference: FirestoreDashboardDocumentReference, data: Record<string, unknown>): void;
  set(reference: FirestoreDashboardDocumentReference, data: Record<string, unknown>): void;
  update(reference: FirestoreDashboardDocumentReference, data: Record<string, unknown>): void;
}

export interface FirestoreDashboardLike {
  collection(name: string): FirestoreCollectionReference;
  collectionGroup(name: string): FirestoreQuery;
  runTransaction<T>(work: (transaction: FirestoreDashboardTransaction) => Promise<T>): Promise<T>;
}

export interface FirestoreDashboardStoreOptions {
  firestore: FirestoreDashboardLike;
  databaseId: string;
  auditEmitter: AuditEmitter;
  auditEmissionStatusReporter: AuditEmissionStatusReporter;
  randomUuid?: () => string;
  now?: () => string;
  correlationId?: () => string;
}

interface MutationResult<T> {
  value: T;
  event: AuditEvent | null;
}

export class FirestoreDashboardStore implements ProfileRepository, AdminRepository, AdminClassroomRepository, AdminInvitationRepository, PaginatedClassroomRepository, InvitationRepository, AuditRepository {
  private readonly firestore: FirestoreDashboardLike;
  private readonly auditEmitter: AuditEmitter;
  private readonly auditEmissionStatusReporter: AuditEmissionStatusReporter;
  private readonly randomUuid: () => string;
  private readonly now: () => string;
  private readonly correlationId: () => string;

  constructor(options: FirestoreDashboardStoreOptions) {
    if (options.databaseId !== DASHBOARD_DATABASE_ID) {
      throw new Error(`FirestoreDashboardStore requires the named ${DASHBOARD_DATABASE_ID} database`);
    }
    this.firestore = options.firestore;
    this.auditEmitter = options.auditEmitter;
    this.auditEmissionStatusReporter = options.auditEmissionStatusReporter;
    this.randomUuid = options.randomUuid ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.correlationId = options.correlationId ?? randomUUID;
  }

  async getProfile(firebaseUid: string): Promise<DashboardProfileV2 | null> {
    const snapshot = await this.profileReference(firebaseUid).get();
    return snapshot.exists ? profileFromSnapshot(snapshot, firebaseUid) : null;
  }

  async onboard(
    principalCandidate: VerifiedPrincipal,
    inputCandidate: DashboardProfileOnboardRequest,
    context: MutationContext,
  ): Promise<DashboardProfileV2> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const input = DashboardProfileOnboardRequestSchema.parse(inputCandidate);
    if (input.role === "teacher") requireVerifiedEmail(principal);
    const profileReference = this.profileReference(principal.uid);
    const verifiedEmail = principal.emailVerified ? principal.email : null;

    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<DashboardProfileV2>> => {
      const existing = await transaction.get(profileReference);
      if (existing.exists) throw new DashboardStoreError("Profile is already onboarded", "profile_exists");
      await this.ensureVerifiedEmailIndex(transaction, principal, context.now);

      const internalProfileId = this.randomUuid();
      const profile = DashboardProfileV2Schema.parse({
        internalProfileId,
        firebaseUid: principal.uid,
        verifiedEmail,
        displayName: principal.displayName,
        roles: input.role === "student" ? { student: "active" } : { teacher: "pending" },
        activeRole: input.role === "student" ? "student" : null,
        onboardingCompleted: true,
        schemaVersion: 2,
        createdAt: context.now,
        updatedAt: context.now,
      });
      transaction.create(profileReference, profile);
      const event = this.createAuditMirror(transaction, profile, {
        action: "profile.onboarded",
        targetType: "profile",
        targetId: principal.uid,
        context,
        after: changes(`roles.${input.role}`, profile.roles[input.role] ?? null),
      });
      return { value: profile, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  async bootstrapAdmin(
    principalCandidate: VerifiedPrincipal,
    configCandidate: AdminBootstrapConfig,
    contextCandidate?: MutationContext,
  ): Promise<DashboardProfileV2> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const config = AdminBootstrapConfigSchema.parse(configCandidate);
    requireVerifiedEmail(principal);
    if (!matchesAdminBootstrap(principal, config)) {
      throw new DashboardStoreError("Verified identity does not match Admin bootstrap configuration", "bootstrap_identity_mismatch");
    }
    const context = contextCandidate ?? { now: this.now(), correlationId: this.correlationId() };
    const profileReference = this.profileReference(principal.uid);

    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<DashboardProfileV2>> => {
      const snapshot = await transaction.get(profileReference);
      const existing = snapshot.exists ? profileFromSnapshot(snapshot, principal.uid) : null;
      if (existing?.roles.admin !== undefined) {
        await this.validateExistingAdminIdentity(transaction, principal, existing);
        return { value: existing, event: null };
      }
      if (existing !== null && existing.verifiedEmail !== null && existing.verifiedEmail !== principal.email) {
        throw new DashboardStoreError("Verified email changed for an existing profile", "verified_email_changed");
      }
      await this.ensureVerifiedEmailIndex(transaction, principal, context.now);

      const profile = DashboardProfileV2Schema.parse(existing === null ? {
        internalProfileId: this.randomUuid(),
        firebaseUid: principal.uid,
        verifiedEmail: principal.email,
        displayName: principal.displayName,
        roles: { admin: "active" },
        activeRole: "admin",
        onboardingCompleted: true,
        schemaVersion: 2,
        createdAt: context.now,
        updatedAt: context.now,
      } : {
        ...existing,
        verifiedEmail: principal.email,
        displayName: principal.displayName,
        roles: { ...existing.roles, admin: "active" },
        activeRole: "admin",
        updatedAt: context.now,
      });
      if (existing === null) transaction.create(profileReference, profile);
      else transaction.set(profileReference, profile);
      const event = this.createAuditMirror(transaction, profile, {
        action: "admin.bootstrap",
        targetType: "profile",
        targetId: principal.uid,
        context,
        after: changes("roles.admin", "active"),
      });
      return { value: profile, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  async listProfiles(principalCandidate: VerifiedPrincipal, pageCandidate: PaginationRequest): Promise<Page<DashboardProfileV2>> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    await this.requireActiveAdmin(principal.uid);
    const page = PaginationRequestSchema.parse(pageCandidate);
    const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "profiles");
    let query = this.firestore.collection("profiles").orderBy("createdAt", "desc").orderBy("__name__", "desc");
    if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
    query = query.limit(page.limit + 1);
    const snapshot = await query.get();
    const items = snapshot.docs.slice(0, page.limit).map((document) => profileFromSnapshot(document, document.id));
    const last = items.at(-1);
    return {
      items,
      nextCursor: snapshot.docs.length > page.limit && last !== undefined
        ? encodeCursor("profiles", last.createdAt, last.firebaseUid)
        : null,
    };
  }

  async listClassrooms(principalCandidate: VerifiedPrincipal, pageCandidate: PaginationRequest): Promise<Page<Classroom>> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    await this.requireActiveAdmin(principal.uid);
    const page = PaginationRequestSchema.parse(pageCandidate);
    const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "classrooms");
    let query = this.firestore.collection("classrooms").orderBy("updatedAt", "desc").orderBy("__name__", "desc");
    if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
    const snapshot = await query.limit(page.limit + 1).get();
    const items = snapshot.docs.slice(0, page.limit).map((document) => classroomFromSnapshot(document));
    const last = items.at(-1);
    return {
      items,
      nextCursor: snapshot.docs.length > page.limit && last !== undefined
        ? encodeCursor("classrooms", last.updatedAt, last.id)
        : null,
    };
  }

  async listInvitations(principalCandidate: VerifiedPrincipal, pageCandidate: PaginationRequest): Promise<Page<ClassroomInvite>> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    await this.requireActiveAdmin(principal.uid);
    const page = PaginationRequestSchema.parse(pageCandidate);
    const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "invitations");
    let query = this.firestore.collectionGroup("invites").orderBy("createdAt", "desc").orderBy("id", "desc");
    if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
    const snapshot = await query.limit(page.limit + 1).get();
    const items = snapshot.docs.slice(0, page.limit).map((document) => invitationFromSnapshot(document));
    const last = items.at(-1);
    return {
      items,
      nextCursor: snapshot.docs.length > page.limit && last !== undefined
        ? encodeCursor("invitations", last.createdAt, last.id)
        : null,
    };
  }

  async getInvitationById(principalCandidate: VerifiedPrincipal, invitationId: string): Promise<ClassroomInvite | null> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    await this.requireActiveAdmin(principal.uid);
    const resolved = await this.resolveInvitationById(invitationId);
    return resolved?.invitation ?? null;
  }

  async revokeInvitationById(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite> {
    return this.transitionInvitation(
      principalCandidate,
      invitationId,
      "invite.revoked",
      context,
      (invitation) => {
        if (invitation.status !== "pending") {
          throw new DashboardStoreError("Only a pending invitation can be revoked", "invitation_transition_invalid");
        }
        return ClassroomInviteSchema.parse({ ...invitation, status: "revoked", updatedAt: context.now });
      },
    );
  }

  async requestInvitationRedelivery(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite> {
    return this.transitionInvitation(
      principalCandidate,
      invitationId,
      "invite.redelivery_requested",
      context,
      (invitation) => {
        if (invitation.status !== "pending" || invitation.delivery === "redelivery_requested") {
          throw new DashboardStoreError("Invitation is not available for redelivery", "invitation_transition_invalid");
        }
        return ClassroomInviteSchema.parse({
          ...invitation,
          delivery: "redelivery_requested",
          deliveryErrorCategory: null,
          updatedAt: context.now,
        });
      },
    );
  }

  async approveTeacher(
    principalCandidate: VerifiedPrincipal,
    targetUid: string,
    context: MutationContext,
  ): Promise<DashboardProfileV2> {
    return this.transitionTeacher(principalCandidate, targetUid, "pending", "active", "teacher.approved", context);
  }

  async suspendTeacher(
    principalCandidate: VerifiedPrincipal,
    targetUid: string,
    context: MutationContext,
  ): Promise<DashboardProfileV2> {
    return this.transitionTeacher(principalCandidate, targetUid, "active", "suspended", "teacher.suspended", context);
  }

  async create(
    principalCandidate: VerifiedPrincipal,
    inputCandidate: CreateClassroomRequest,
    context: MutationContext,
  ): Promise<Classroom> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const input = CreateClassroomRequestSchema.parse(inputCandidate);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<Classroom>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      requireActiveTeacher(actor);
      const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const idempotencyReference = this.idempotencyReference(principal.uid, "classroom.create", context.correlationId);
      const idempotencySnapshot = await transaction.get(idempotencyReference);
      if (idempotencySnapshot.exists) {
        const key = idempotencySnapshot.data();
        if (!isIdempotencyKey(key, principal.uid, "classroom.create", context.correlationId, requestHash)) {
          throw new DashboardStoreError("Idempotency key was reused for another request", "idempotency_conflict");
        }
        const replaySnapshot = await transaction.get(this.classroomReference(key.targetId));
        if (!replaySnapshot.exists) throw new DashboardStoreError("Idempotency target is unavailable", "idempotency_conflict");
        const replay = classroomFromSnapshot(replaySnapshot);
        requireOwnedClassroom(replay, principal.uid);
        return { value: replay, event: null };
      }
      const classroom = ClassroomSchema.parse({
        id: this.randomUuid(),
        ownerUid: principal.uid,
        name: input.name,
        status: "active",
        createdAt: context.now,
        updatedAt: context.now,
      });
      transaction.create(this.classroomReference(classroom.id), classroom);
      transaction.create(idempotencyReference, {
        actorUid: principal.uid,
        action: "classroom.create",
        correlationId: context.correlationId,
        requestHash,
        targetId: classroom.id,
        createdAt: context.now,
      });
      const event = this.createAuditMirror(transaction, actor, {
        action: "classroom.created",
        targetType: "classroom",
        targetId: classroom.id,
        context,
        after: changes("status", "active"),
      });
      return { value: classroom, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  async getClassroom(principalCandidate: VerifiedPrincipal, classroomId: string): Promise<Classroom | null> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const profile = await this.getProfile(principal.uid);
    if (profile === null) throw new DashboardStoreError("Profile does not exist", "profile_not_found");
    const snapshot = await this.classroomReference(classroomId).get();
    if (!snapshot.exists) return null;
    const classroom = classroomFromSnapshot(snapshot);
    if (profile.roles.teacher === "active" && classroom.ownerUid === principal.uid) {
      return classroom;
    }
    if (profile.roles.student === "active") {
      const membership = await this.studentMembershipReference(principal.uid, classroomId).get();
      if (membership.exists && membershipFromProjection(membership, principal.uid, classroomId).status === "active") return classroom;
    }
    throw new DashboardStoreError("Classroom is outside the verified principal scope", "classroom_forbidden");
  }

  async listForPrincipal(principalCandidate: VerifiedPrincipal): Promise<Classroom[]> {
    const page = await this.listForPrincipalPage(principalCandidate, { limit: MAX_PAGE_SIZE });
    return page.items;
  }

  async listForPrincipalPage(principalCandidate: VerifiedPrincipal, pageCandidate: PaginationRequest): Promise<Page<Classroom>> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const profile = await this.getProfile(principal.uid);
    if (profile === null) throw new DashboardStoreError("Profile does not exist", "profile_not_found");
    const page = PaginationRequestSchema.parse(pageCandidate);
    if (profile.activeRole === "teacher" && profile.roles.teacher === "active") {
      const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "teacherClassrooms");
      let query = this.firestore.collection("classrooms")
        .where("ownerUid", "==", principal.uid)
        .orderBy("updatedAt", "desc").orderBy("__name__", "desc");
      if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
      const snapshot = await query.limit(page.limit + 1).get();
      const items = classroomsFromQuery({ docs: snapshot.docs.slice(0, page.limit) });
      const last = items.at(-1);
      return { items, nextCursor: snapshot.docs.length > page.limit && last !== undefined
        ? encodeCursor("teacherClassrooms", last.updatedAt, last.id) : null };
    }
    if (profile.activeRole === "student" && profile.roles.student === "active") {
      const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "studentClassrooms");
      let query = this.studentMembershipCollection(principal.uid)
        .where("status", "==", "active")
        .orderBy("updatedAt", "desc").orderBy("__name__", "desc");
      if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
      const membershipSnapshot = await query.limit(page.limit + 1).get();
      const visibleMemberships = membershipSnapshot.docs.slice(0, page.limit);
      const classrooms = await Promise.all(visibleMemberships.map(async (membership) => {
        const projection = membershipFromProjection(membership, principal.uid, membership.id);
        const classroom = await this.classroomReference(projection.classroomId).get();
        if (!classroom.exists) throw new DashboardStoreError("Student membership target is unavailable", "membership_projection_invalid");
        return classroomFromSnapshot(classroom);
      }));
      const items = classrooms;
      const lastMembership = visibleMemberships.at(-1);
      const lastProjection = lastMembership === undefined ? undefined : membershipFromProjection(lastMembership, principal.uid, lastMembership.id);
      return { items, nextCursor: membershipSnapshot.docs.length > page.limit && lastProjection !== undefined
        ? encodeCursor("studentClassrooms", lastProjection.updatedAt, lastProjection.classroomId) : null };
    }
    return { items: [], nextCursor: null };
  }

  async archive(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    context: MutationContext,
  ): Promise<Classroom> {
    return this.transitionClassroom(principalCandidate, classroomId, "active", "archived", "classroom.archived", context, "admin_or_owner");
  }

  async archiveOwned(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    context: MutationContext,
  ): Promise<Classroom> {
    return this.transitionClassroom(principalCandidate, classroomId, "active", "archived", "classroom.archived", context, "owner_only");
  }

  async restore(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    context: MutationContext,
  ): Promise<Classroom> {
    return this.transitionClassroom(principalCandidate, classroomId, "archived", "active", "classroom.restored", context, "admin_or_owner");
  }

  async getInvitation(classroomId: string, invitationId: string): Promise<ClassroomInvite | null> {
    const snapshot = await this.invitationReference(classroomId, invitationId).get();
    return snapshot.exists ? invitationFromSnapshot(snapshot) : null;
  }

  async inspectInvitation(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
  ): Promise<InvitationInspection> {
    return this.inspectInvitationState(principalCandidate, invitationId, false);
  }

  async resolveInvitationForAcceptance(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
  ): Promise<InvitationInspection> {
    return this.inspectInvitationState(principalCandidate, invitationId, true);
  }

  private async inspectInvitationState(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
    allowAcceptedBySameUid: boolean,
  ): Promise<InvitationInspection> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    requireVerifiedEmail(principal);
    const resolved = await this.resolveInvitationById(invitationId);
    if (resolved === null) throw invalidInvitation();
    const invitation = resolved.invitation;
    const acceptableStatus = invitation.status === "pending"
      || (allowAcceptedBySameUid && invitation.status === "accepted" && invitation.acceptedUid === principal.uid);
    if (invitation.normalizedEmail !== principal.email || !acceptableStatus || Date.parse(invitation.expiresAt) <= Date.parse(this.now())) {
      throw invalidInvitation();
    }
    const classroomSnapshot = await this.classroomReference(invitation.classroomId).get();
    if (!classroomSnapshot.exists) throw invalidInvitation();
    const classroom = classroomFromSnapshot(classroomSnapshot);
    if (classroom.status !== "active") throw invalidInvitation();
    const teacher = await this.getProfile(invitation.ownerUid);
    if (teacher === null || teacher.roles.teacher !== "active" || teacher.verifiedEmail === null) throw invalidInvitation();
    const actor = await this.getProfile(principal.uid);
    if (actor !== null && actor.verifiedEmail !== principal.email) throw invalidInvitation();
    return {
      invite: invitation,
      classroomName: classroom.name,
      teacherName: teacher.displayName ?? "ViJEEta teacher",
      teacherEmail: teacher.verifiedEmail,
      studentOnboardingRequired: actor?.roles.student !== "active",
    };
  }

  async listRoster(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    page: RosterPagination,
  ): Promise<ClassroomRosterResponse> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const limit = boundedRosterLimit(page.limit);
    const classroom = await this.requireOwnedClassroom(principal, classroomId);
    const memberCursor = page.memberCursor === undefined ? null : decodeCursor(page.memberCursor, "rosterMembers");
    const invitationCursor = page.invitationCursor === undefined ? null : decodeCursor(page.invitationCursor, "rosterInvitations");
    let memberQuery = this.classroomReference(classroom.id).collection("members")
      .orderBy("updatedAt", "desc").orderBy("__name__", "desc");
    if (memberCursor !== null) memberQuery = memberQuery.startAfter(memberCursor.createdAt, memberCursor.id);
    let invitationQuery = this.classroomReference(classroom.id).collection("invites")
      .orderBy("updatedAt", "desc").orderBy("__name__", "desc");
    if (invitationCursor !== null) invitationQuery = invitationQuery.startAfter(invitationCursor.createdAt, invitationCursor.id);
    const [memberSnapshot, invitationSnapshot] = await Promise.all([
      memberQuery.limit(limit + 1).get(),
      invitationQuery.limit(limit + 1).get(),
    ]);
    const memberships = memberSnapshot.docs.slice(0, limit).map((snapshot) => membershipFromClassroom(snapshot, classroom.id));
    const members = await Promise.all(memberships.map(async (membership) => {
      const profile = await this.getProfile(membership.studentUid);
      if (profile === null || profile.roles.student === undefined) throw new DashboardStoreError("Roster member profile is invalid", "membership_projection_invalid");
      return { studentUid: membership.studentUid, displayName: profile.displayName, status: membership.status, joinedAt: membership.joinedAt };
    }));
    const invitations = invitationSnapshot.docs.slice(0, limit).map((snapshot) => {
      const invite = invitationFromSnapshot(snapshot);
      const projectedStatus = invite.status === "pending" && Date.parse(invite.expiresAt) <= Date.parse(this.now()) ? "expired" as const : invite.status;
      return {
        id: invite.id,
        maskedEmail: maskEmail(invite.normalizedEmail),
        expiresAt: invite.expiresAt,
        status: projectedStatus,
        delivery: invite.delivery,
        ...(invite.deliveryErrorCategory === undefined ? {} : { deliveryErrorCategory: invite.deliveryErrorCategory }),
        createdAt: invite.createdAt,
        updatedAt: invite.updatedAt,
      };
    });
    const lastMember = memberships.at(-1);
    const lastInvitation = invitations.at(-1);
    return ClassroomRosterResponseSchema.parse({
      members,
      invitations,
      nextMemberCursor: memberSnapshot.docs.length > limit && lastMember !== undefined
        ? encodeCursor("rosterMembers", lastMember.updatedAt, lastMember.studentUid) : null,
      nextInvitationCursor: invitationSnapshot.docs.length > limit && lastInvitation !== undefined
        ? encodeCursor("rosterInvitations", lastInvitation.updatedAt, lastInvitation.id) : null,
    });
  }

  async createInvitation(
    principalCandidate: VerifiedPrincipal,
    input: CreateInvitationInput,
    context: MutationContext,
  ): Promise<InvitationCreationResult> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    requireVerifiedEmail(principal);
    assertSafeDocumentId(input.id, "Invitation ID");
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<InvitationCreationResult>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      requireActiveTeacher(actor);
      if (actor.verifiedEmail !== principal.email) throw new DashboardStoreError("Verified email changed", "verified_email_changed");
      const requestHash = createHash("sha256").update(JSON.stringify({ classroomId: input.classroomId, normalizedEmail: input.normalizedEmail })).digest("hex");
      const idempotencyReference = this.idempotencyReference(principal.uid, "invite.create", context.correlationId);
      const idempotencySnapshot = await transaction.get(idempotencyReference);
      if (idempotencySnapshot.exists) {
        const key = idempotencySnapshot.data();
        if (!isInvitationIdempotencyKey(key, principal.uid, "invite.create", context.correlationId, requestHash)) {
          throw new DashboardStoreError("Idempotency key was reused for another request", "idempotency_conflict");
        }
        const replaySnapshot = await transaction.get(this.invitationReference(key.classroomId, key.targetId));
        if (!replaySnapshot.exists) throw new DashboardStoreError("Idempotency target is unavailable", "idempotency_conflict");
        return { value: { disposition: "idempotent_replay", invite: invitationFromSnapshot(replaySnapshot) }, event: null };
      }
      const classroomSnapshot = await transaction.get(this.classroomReference(input.classroomId));
      if (!classroomSnapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
      const classroom = classroomFromSnapshot(classroomSnapshot);
      requireOwnedActiveClassroom(classroom, principal.uid);
      await this.consumeInviteRateLimit(transaction, principal.uid, input.classroomId, input.normalizedEmail, context.now);
      const invite = ClassroomInviteSchema.parse({
        ...input,
        ownerUid: principal.uid,
        status: "pending",
        delivery: "pending",
        acceptedUid: null,
        acceptedAt: null,
        createdAt: context.now,
        updatedAt: context.now,
      });
      transaction.create(this.invitationReference(input.classroomId, input.id), invite);
      transaction.create(idempotencyReference, {
        actorUid: principal.uid,
        action: "invite.create",
        correlationId: context.correlationId,
        requestHash,
        classroomId: input.classroomId,
        targetId: input.id,
        createdAt: context.now,
      });
      const event = this.createAuditMirror(transaction, actor, { action: "invite.created", targetType: "invite", targetId: input.id, context, after: changes("status", "pending") });
      return { value: { disposition: "created", invite }, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async beginInvitationDelivery(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    provider: "capture" | "smtp",
    expectedToken: InvitationTokenBinding,
    context: MutationContext,
  ): Promise<{ attemptId: string; dispatch: InvitationDispatch }> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    requireVerifiedEmail(principal);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<{ attemptId: string; dispatch: InvitationDispatch }>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      requireActiveTeacher(actor);
      if (actor.verifiedEmail !== principal.email) throw new DashboardStoreError("Verified email changed", "verified_email_changed");
      const classroomSnapshot = await transaction.get(this.classroomReference(classroomId));
      if (!classroomSnapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
      const classroom = classroomFromSnapshot(classroomSnapshot);
      requireOwnedActiveClassroom(classroom, principal.uid);
      const reference = this.invitationReference(classroomId, invitationId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new DashboardStoreError("Invitation does not exist", "invitation_not_found");
      const invite = invitationFromSnapshot(snapshot);
      if (invite.ownerUid !== principal.uid
        || invite.status !== "pending"
        || invite.delivery !== "pending"
        || invite.tokenDigest !== expectedToken.tokenDigest
        || invite.tokenVersion !== expectedToken.tokenVersion
        || Date.parse(invite.expiresAt) <= Date.parse(context.now)) throw invalidInvitationTransition();
      const attemptId = deliveryAttemptId(invite.id, invite.tokenVersion);
      transaction.create(reference.collection("deliveryAttempts").doc(attemptId), {
        id: attemptId,
        invitationId,
        classroomId,
        ownerUid: principal.uid,
        ownerProfileId: actor.internalProfileId,
        tokenDigest: invite.tokenDigest,
        tokenVersion: invite.tokenVersion,
        provider,
        status: "pending",
        createdAt: context.now,
        updatedAt: context.now,
      });
      const event = this.createAuditMirror(transaction, actor, { action: "invite.delivery_started", targetType: "invite", targetId: invitationId, context, after: changes("delivery", "pending") });
      return { value: { attemptId, dispatch: { invite, classroomName: classroom.name, teacherName: actor.displayName ?? "ViJEEta teacher", teacherEmail: principal.email } }, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async completeInvitationDelivery(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    attemptId: string,
    outcome: InvitationDeliveryOutcome,
    context: MutationContext,
  ): Promise<ClassroomInvite> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<ClassroomInvite>> => {
      const invitationReference = this.invitationReference(classroomId, invitationId);
      const attemptReference = invitationReference.collection("deliveryAttempts").doc(attemptId);
      const [inviteSnapshot, attemptSnapshot] = await Promise.all([transaction.get(invitationReference), transaction.get(attemptReference)]);
      if (!inviteSnapshot.exists || !attemptSnapshot.exists) throw invalidInvitationTransition();
      const attempt = attemptSnapshot.data();
      if (attempt?.status !== "pending"
        || attempt.invitationId !== invitationId
        || attempt.classroomId !== classroomId
        || attempt.ownerUid !== principal.uid
        || typeof attempt.ownerProfileId !== "string"
        || attempt.provider !== outcome.provider) throw invalidInvitationTransition();
      const invite = invitationFromSnapshot(inviteSnapshot);
      if (invite.ownerUid !== principal.uid
        || invite.delivery !== "pending"
        || attempt.tokenDigest !== invite.tokenDigest
        || attempt.tokenVersion !== invite.tokenVersion) throw invalidInvitationTransition();
      const category = outcome.status === "unknown" ? "ambiguous" : outcome.status === "failed" ? (outcome.retryable ? "retryable" : "permanent") : null;
      const updated = ClassroomInviteSchema.parse({ ...invite, delivery: outcome.status, deliveryErrorCategory: category, updatedAt: context.now });
      transaction.update(invitationReference, updated);
      transaction.update(attemptReference, {
        status: outcome.status,
        ...(outcome.providerMessageId === undefined ? {} : { providerMessageId: boundedProviderMessageId(outcome.providerMessageId) }),
        ...(outcome.category === undefined ? {} : { category: outcome.category }),
        updatedAt: context.now,
      });
      const action = outcome.status === "sent" ? "invite.delivery_sent" : outcome.status === "failed" ? "invite.delivery_failed" : "invite.delivery_unknown";
      const event = this.createAuditMirror(transaction, { firebaseUid: principal.uid, internalProfileId: attempt.ownerProfileId }, { action, targetType: "invite", targetId: invitationId, context, after: changes("delivery", outcome.status) });
      return { value: updated, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async rotateInvitation(
    principalCandidate: VerifiedPrincipal,
    input: CreateInvitationInput,
    context: MutationContext,
  ): Promise<InvitationRotationResult> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    requireVerifiedEmail(principal);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<InvitationRotationResult>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      requireActiveTeacher(actor);
      if (actor.verifiedEmail !== principal.email) throw new DashboardStoreError("Verified email changed", "verified_email_changed");
      const requestHash = createHash("sha256").update(JSON.stringify({ classroomId: input.classroomId, invitationId: input.id })).digest("hex");
      const idempotencyReference = this.idempotencyReference(principal.uid, "invite.redeliver", context.correlationId);
      const idempotencySnapshot = await transaction.get(idempotencyReference);
      if (idempotencySnapshot.exists) {
        const key = idempotencySnapshot.data();
        if (!isInvitationIdempotencyKey(key, principal.uid, "invite.redeliver", context.correlationId, requestHash)) {
          throw new DashboardStoreError("Idempotency key was reused for another request", "idempotency_conflict");
        }
        const replaySnapshot = await transaction.get(this.invitationReference(key.classroomId, key.targetId));
        if (!replaySnapshot.exists) throw new DashboardStoreError("Idempotency target is unavailable", "idempotency_conflict");
        return { value: { disposition: "idempotent_replay", invite: invitationFromSnapshot(replaySnapshot) }, event: null };
      }
      const classroomSnapshot = await transaction.get(this.classroomReference(input.classroomId));
      if (!classroomSnapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
      requireOwnedActiveClassroom(classroomFromSnapshot(classroomSnapshot), principal.uid);
      const reference = this.invitationReference(input.classroomId, input.id);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new DashboardStoreError("Invitation does not exist", "invitation_not_found");
      const invite = invitationFromSnapshot(snapshot);
      if (invite.ownerUid !== principal.uid
        || invite.status !== "pending"
        || Date.parse(invite.expiresAt) <= Date.parse(context.now)
        || input.tokenVersion !== invite.tokenVersion + 1
        || input.normalizedEmail !== invite.normalizedEmail) throw invalidInvitationTransition();
      const currentAttempt = await transaction.get(reference.collection("deliveryAttempts").doc(deliveryAttemptId(invite.id, invite.tokenVersion)));
      if (currentAttempt.exists && currentAttempt.data()?.status === "pending") throw invalidInvitationTransition();
      await this.consumeInviteRateLimit(transaction, principal.uid, input.classroomId, input.normalizedEmail, context.now);
      const updated = ClassroomInviteSchema.parse({ ...invite, tokenDigest: input.tokenDigest, tokenVersion: input.tokenVersion, expiresAt: input.expiresAt, delivery: "pending", deliveryErrorCategory: null, updatedAt: context.now });
      transaction.update(reference, updated);
      transaction.create(idempotencyReference, {
        actorUid: principal.uid,
        action: "invite.redeliver",
        correlationId: context.correlationId,
        requestHash,
        classroomId: input.classroomId,
        targetId: input.id,
        createdAt: context.now,
      });
      const event = this.createAuditMirror(transaction, actor, { action: "invite.redelivered", targetType: "invite", targetId: invite.id, context, before: changes("tokenVersion", String(invite.tokenVersion)), after: changes("tokenVersion", String(updated.tokenVersion)) });
      return { value: { disposition: "rotated", invite: updated }, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async revokeInvitation(principalCandidate: VerifiedPrincipal, classroomId: string, invitationId: string, context: MutationContext): Promise<ClassroomInvite> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<ClassroomInvite>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      requireActiveTeacher(actor);
      const classroomSnapshot = await transaction.get(this.classroomReference(classroomId));
      if (!classroomSnapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
      requireOwnedClassroom(classroomFromSnapshot(classroomSnapshot), principal.uid);
      const reference = this.invitationReference(classroomId, invitationId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new DashboardStoreError("Invitation does not exist", "invitation_not_found");
      const invite = invitationFromSnapshot(snapshot);
      if (invite.status !== "pending" || invite.ownerUid !== principal.uid) throw invalidInvitationTransition();
      const updated = ClassroomInviteSchema.parse({ ...invite, status: "revoked", updatedAt: context.now });
      transaction.update(reference, updated);
      const event = this.createAuditMirror(transaction, actor, { action: "invite.revoked", targetType: "invite", targetId: invite.id, context, before: changes("status", "pending"), after: changes("status", "revoked") });
      return { value: updated, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async acceptInvitation(
    principalCandidate: VerifiedPrincipal,
    input: InvitationAcceptanceInput,
    context: MutationContext,
  ): Promise<ClassroomMembership> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    requireVerifiedEmail(principal);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<ClassroomMembership>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      if (actor.roles.student !== "active") throw new DashboardStoreError("An active Student role is required", "student_role_required");
      if (actor.verifiedEmail !== principal.email) throw new DashboardStoreError("Verified email changed", "verified_email_changed");
      const emailIndex = await transaction.get(this.emailIndexReference(principal.email));
      const index = emailIndex.data();
      if (!emailIndex.exists || !isValidEmailIndex(index, principal.email) || index.firebaseUid !== principal.uid) throw new DashboardStoreError("Verified email index is invalid", "email_index_invalid");
      const invitationReference = this.invitationReference(input.classroomId, input.invitationId);
      const inviteSnapshot = await transaction.get(invitationReference);
      if (!inviteSnapshot.exists) throw invalidInvitation();
      const invite = invitationFromSnapshot(inviteSnapshot);
      if (invite.classroomId !== input.classroomId || invite.id !== input.invitationId || invite.normalizedEmail !== principal.email || invite.tokenDigest !== input.expectedTokenDigest || invite.tokenVersion !== input.expectedTokenVersion || Date.parse(invite.expiresAt) <= Date.parse(context.now)) throw invalidInvitation();
      const memberReference = this.classroomReference(input.classroomId).collection("members").doc(principal.uid);
      const reverseReference = this.studentMembershipReference(principal.uid, input.classroomId);
      if (invite.status === "accepted" && invite.acceptedUid === principal.uid) {
        const [memberSnapshot, reverseSnapshot] = await Promise.all([transaction.get(memberReference), transaction.get(reverseReference)]);
        if (!memberSnapshot.exists || !reverseSnapshot.exists) throw new DashboardStoreError("Membership projection is invalid", "membership_projection_invalid");
        const member = membershipFromClassroom(memberSnapshot, input.classroomId);
        membershipFromProjection(reverseSnapshot, principal.uid, input.classroomId);
        return { value: member, event: null };
      }
      if (invite.status !== "pending") throw invalidInvitation();
      const classroomSnapshot = await transaction.get(this.classroomReference(input.classroomId));
      if (!classroomSnapshot.exists || classroomFromSnapshot(classroomSnapshot).status !== "active") throw invalidInvitation();
      const membership = ClassroomMembershipSchema.parse({ classroomId: input.classroomId, studentUid: principal.uid, sourceInviteId: invite.id, status: "active", joinedAt: context.now, updatedAt: context.now });
      transaction.create(memberReference, membership);
      transaction.create(reverseReference, membership);
      const accepted = ClassroomInviteSchema.parse({ ...invite, status: "accepted", acceptedUid: principal.uid, acceptedAt: context.now, updatedAt: context.now });
      transaction.update(invitationReference, accepted);
      const event = this.createAuditMirror(transaction, actor, { action: "invite.accepted", targetType: "invite", targetId: invite.id, context, after: changes("status", "accepted") });
      return { value: membership, event };
    });
    await this.emit(result.event);
    return result.value;
  }

  async listAuditEvents(principalCandidate: VerifiedPrincipal, pageCandidate: PaginationRequest): Promise<Page<AuditEvent>> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    await this.requireActiveAdmin(principal.uid);
    const page = PaginationRequestSchema.parse(pageCandidate);
    const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor, "auditEvents");
    let query = this.firestore.collection("auditEvents").orderBy("createdAt", "desc").orderBy("__name__", "desc");
    if (cursor !== null) query = query.startAfter(cursor.createdAt, cursor.id);
    const snapshot = await query.limit(page.limit + 1).get();
    const items = snapshot.docs.slice(0, page.limit).map((document) => auditFromSnapshot(document));
    const last = items.at(-1);
    return {
      items,
      nextCursor: snapshot.docs.length > page.limit && last !== undefined
        ? encodeCursor("auditEvents", last.createdAt, last.id)
        : null,
    };
  }

  private async transitionInvitation(
    principalCandidate: VerifiedPrincipal,
    invitationId: string,
    action: "invite.revoked" | "invite.redelivery_requested",
    context: MutationContext,
    update: (invitation: ClassroomInvite) => ClassroomInvite,
  ): Promise<ClassroomInvite> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const reason = requiredReason(context);
    await this.requireActiveAdmin(principal.uid);
    const resolved = await this.resolveInvitationById(invitationId);
    if (resolved === null) throw new DashboardStoreError("Invitation does not exist", "invitation_not_found");

    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<ClassroomInvite>> => {
      const actor = await this.getRequiredActiveAdminProfile(transaction, principal.uid);
      const snapshot = await transaction.get(resolved.reference);
      if (!snapshot.exists) throw new DashboardStoreError("Invitation does not exist", "invitation_not_found");
      const invitation = invitationFromSnapshot(snapshot);
      if (invitation.id !== invitationId || invitation.classroomId !== resolved.invitation.classroomId) {
        throw new DashboardStoreError("Invitation identity is not unique", "invitation_identity_collision");
      }
      const updated = update(invitation);
      transaction.update(resolved.reference, updated);
      const field = action === "invite.revoked" ? "status" : "delivery";
      const event = this.createAuditMirror(transaction, actor, {
        action,
        targetType: "invite",
        targetId: invitationId,
        context: { ...context, reason },
        before: changes(field, action === "invite.revoked" ? invitation.status : invitation.delivery),
        after: changes(field, action === "invite.revoked" ? updated.status : updated.delivery),
      });
      return { value: updated, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  private async resolveInvitationById(invitationId: string): Promise<{
    invitation: ClassroomInvite;
    reference: FirestoreDashboardDocumentReference;
  } | null> {
    assertSafeDocumentId(invitationId, "Invitation ID");
    const snapshot = await this.firestore.collectionGroup("invites")
      .where("id", "==", invitationId)
      .limit(2)
      .get();
    if (snapshot.docs.length === 0) return null;
    if (snapshot.docs.length !== 1) {
      throw new DashboardStoreError("Invitation identity is not unique", "invitation_identity_collision");
    }
    const invitation = invitationFromSnapshot(snapshot.docs[0]!);
    return {
      invitation,
      reference: this.invitationReference(invitation.classroomId, invitation.id),
    };
  }

  private async transitionTeacher(
    principalCandidate: VerifiedPrincipal,
    targetUid: string,
    from: "pending" | "active",
    to: "active" | "suspended",
    action: "teacher.approved" | "teacher.suspended",
    context: MutationContext,
  ): Promise<DashboardProfileV2> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const reason = requiredReason(context);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<DashboardProfileV2>> => {
      const actor = await this.getRequiredActiveAdminProfile(transaction, principal.uid);
      const targetReference = this.profileReference(targetUid);
      const targetSnapshot = await transaction.get(targetReference);
      if (!targetSnapshot.exists) throw new DashboardStoreError("Target profile does not exist", "profile_not_found");
      const target = profileFromSnapshot(targetSnapshot, targetUid);
      if (target.roles.teacher !== from) {
        throw new DashboardStoreError(`Teacher must be ${from} before this transition`, "teacher_transition_invalid");
      }
      const updated = DashboardProfileV2Schema.parse({
        ...target,
        roles: { ...target.roles, teacher: to },
        activeRole: to === "active" ? target.activeRole ?? "teacher" : target.activeRole === "teacher" ? null : target.activeRole,
        updatedAt: context.now,
      });
      transaction.set(targetReference, updated);
      const event = this.createAuditMirror(transaction, actor, {
        action,
        targetType: "profile",
        targetId: targetUid,
        context: { ...context, reason },
        before: changes("roles.teacher", from),
        after: changes("roles.teacher", to),
      });
      return { value: updated, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  private async transitionClassroom(
    principalCandidate: VerifiedPrincipal,
    classroomId: string,
    from: "active" | "archived",
    to: "active" | "archived",
    action: "classroom.archived" | "classroom.restored",
    context: MutationContext,
    authority: "admin_or_owner" | "owner_only",
  ): Promise<Classroom> {
    const principal = VerifiedPrincipalSchema.parse(principalCandidate);
    const reason = requiredReason(context);
    const result = await this.firestore.runTransaction(async (transaction): Promise<MutationResult<Classroom>> => {
      const actor = await this.getRequiredProfile(transaction, principal.uid);
      const classroomReference = this.classroomReference(classroomId);
      const classroomSnapshot = await transaction.get(classroomReference);
      if (!classroomSnapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
      const classroom = classroomFromSnapshot(classroomSnapshot);
      const isAdmin = actor.roles.admin === "active";
      const isOwner = actor.roles.teacher === "active" && classroom.ownerUid === principal.uid;
      if ((authority === "owner_only" && !isOwner) || (authority === "admin_or_owner" && !isAdmin && !isOwner)) {
        throw new DashboardStoreError("Classroom is outside the verified principal scope", "classroom_forbidden");
      }
      if (classroom.status !== from) {
        throw new DashboardStoreError(`Classroom must be ${from} before this transition`, "classroom_transition_invalid");
      }
      const updated = ClassroomSchema.parse({ ...classroom, status: to, updatedAt: context.now });
      transaction.update(classroomReference, updated);
      const event = this.createAuditMirror(transaction, actor, {
        action,
        targetType: "classroom",
        targetId: classroomId,
        context: { ...context, reason },
        before: changes("status", from),
        after: changes("status", to),
      });
      return { value: updated, event };
    });

    await this.emit(result.event);
    return result.value;
  }

  private async ensureVerifiedEmailIndex(
    transaction: FirestoreDashboardTransaction,
    principal: VerifiedPrincipal,
    now: string,
  ): Promise<void> {
    if (!principal.emailVerified || principal.email === null) return;
    const reference = this.emailIndexReference(principal.email);
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (snapshot.exists && (data?.firebaseUid !== principal.uid || data.normalizedEmail !== principal.email)) {
      throw new DashboardStoreError("Verified email is already indexed to another identity", "email_index_collision");
    }
    const index = {
      normalizedEmail: principal.email,
      firebaseUid: principal.uid,
      createdAt: typeof data?.createdAt === "string" ? data.createdAt : now,
      updatedAt: now,
    };
    if (snapshot.exists) transaction.update(reference, index);
    else transaction.create(reference, index);
  }

  private async validateExistingAdminIdentity(
    transaction: FirestoreDashboardTransaction,
    principal: VerifiedPrincipal & { email: string; emailVerified: true },
    profile: DashboardProfileV2,
  ): Promise<void> {
    if (profile.verifiedEmail !== principal.email) {
      throw new DashboardStoreError("Verified email changed for an existing profile", "verified_email_changed");
    }
    const snapshot = await transaction.get(this.emailIndexReference(principal.email));
    const data = snapshot.data();
    if (!snapshot.exists || !isValidEmailIndex(data, principal.email)) {
      throw new DashboardStoreError("Verified email index is missing or invalid", "email_index_invalid");
    }
    if (data.firebaseUid !== principal.uid) {
      throw new DashboardStoreError("Verified email is indexed to another identity", "email_index_collision");
    }
  }

  private createAuditMirror(
    transaction: FirestoreDashboardTransaction,
    actor: Pick<DashboardProfileV2, "firebaseUid" | "internalProfileId">,
    input: {
      action: AuditAction;
      targetType: AuditEvent["targetType"];
      targetId: string;
      context: MutationContext;
      before?: RedactedAuditChangeSet;
      after?: RedactedAuditChangeSet;
    },
  ): AuditEvent {
    const eventId = this.randomUuid();
    const event = AuditEventSchema.parse({
      id: eventId,
      actorUid: actor.firebaseUid,
      actorProfileId: actor.internalProfileId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.context.reason?.trim() || null,
      correlationId: input.context.correlationId,
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
      canonicalLogInsertId: eventId,
      createdAt: input.context.now,
    });
    transaction.create(this.auditReference(event.id), event);
    return event;
  }

  private async emit(event: AuditEvent | null): Promise<void> {
    if (event === null) return;
    try {
      await this.auditEmitter.emit(event);
    } catch {
      await this.reportAuditEmission({
        eventId: event.id,
        action: event.action,
        status: "deferred",
        category: "canonical_emit_failed",
      });
      return;
    }
    await this.reportAuditEmission({ eventId: event.id, action: event.action, status: "emitted" });
  }

  private async reportAuditEmission(status: Parameters<AuditEmissionStatusReporter["report"]>[0]): Promise<void> {
    try {
      await this.auditEmissionStatusReporter.report(status);
    } catch {
      // The committed Firestore mirror remains the durable replay source.
    }
  }

  private async getRequiredProfile(
    transaction: FirestoreDashboardTransaction,
    firebaseUid: string,
  ): Promise<DashboardProfileV2> {
    const snapshot = await transaction.get(this.profileReference(firebaseUid));
    if (!snapshot.exists) throw new DashboardStoreError("Profile does not exist", "profile_not_found");
    return profileFromSnapshot(snapshot, firebaseUid);
  }

  private async getRequiredActiveAdminProfile(
    transaction: FirestoreDashboardTransaction,
    firebaseUid: string,
  ): Promise<DashboardProfileV2> {
    const snapshot = await transaction.get(this.profileReference(firebaseUid));
    if (!snapshot.exists) throw new DashboardStoreError("An active Admin profile is required", "admin_required");
    const profile = profileFromSnapshot(snapshot, firebaseUid);
    requireActiveAdmin(profile);
    return profile;
  }

  private async requireActiveAdmin(firebaseUid: string): Promise<DashboardProfileV2> {
    const profile = await this.getProfile(firebaseUid);
    if (profile === null) throw new DashboardStoreError("An active Admin profile is required", "admin_required");
    requireActiveAdmin(profile);
    return profile;
  }

  private async requireOwnedClassroom(principal: VerifiedPrincipal, classroomId: string): Promise<Classroom> {
    const profile = await this.getProfile(principal.uid);
    if (profile === null || profile.roles.teacher !== "active") throw new DashboardStoreError("An active Teacher profile is required", "active_teacher_required");
    const snapshot = await this.classroomReference(classroomId).get();
    if (!snapshot.exists) throw new DashboardStoreError("Classroom does not exist", "classroom_not_found");
    const classroom = classroomFromSnapshot(snapshot);
    requireOwnedClassroom(classroom, principal.uid);
    return classroom;
  }

  private async consumeInviteRateLimit(
    transaction: FirestoreDashboardTransaction,
    ownerUid: string,
    classroomId: string,
    normalizedEmail: string,
    now: string,
  ): Promise<void> {
    const reference = this.classroomReference(classroomId).collection("inviteRateLimits")
      .doc(createHash("sha256").update(`${ownerUid}\0${normalizedEmail}`).digest("hex"));
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const nowMs = Date.parse(now);
    const windowStart = typeof data?.windowStart === "string" ? Date.parse(data.windowStart) : Number.NaN;
    const inWindow = Number.isFinite(windowStart) && nowMs - windowStart < 24 * 60 * 60 * 1_000;
    const count = inWindow && Number.isSafeInteger(data?.count) ? Number(data?.count) : 0;
    if (count >= 5) throw new DashboardStoreError("Invitation rate limit exceeded", "rate_limited");
    const next = { ownerUid, classroomId, normalizedEmailHash: createHash("sha256").update(normalizedEmail).digest("hex"), count: count + 1, windowStart: inWindow ? data?.windowStart : now, updatedAt: now };
    if (snapshot.exists) transaction.set(reference, next);
    else transaction.create(reference, next);
  }

  private profileReference(firebaseUid: string): FirestoreDashboardDocumentReference {
    assertSafeDocumentId(firebaseUid, "Firebase UID");
    return this.firestore.collection("profiles").doc(firebaseUid);
  }

  private emailIndexReference(normalizedEmail: string): FirestoreDashboardDocumentReference {
    return this.firestore.collection("profileEmailIndex").doc(createHash("sha256").update(normalizedEmail).digest("hex"));
  }

  private classroomReference(classroomId: string): FirestoreDashboardDocumentReference {
    assertSafeDocumentId(classroomId, "Classroom ID");
    return this.firestore.collection("classrooms").doc(classroomId);
  }

  private studentMembershipCollection(studentUid: string): FirestoreCollectionReference {
    assertSafeDocumentId(studentUid, "Student UID");
    return this.firestore.collection("studentMemberships").doc(studentUid).collection("classes");
  }

  private invitationReference(classroomId: string, invitationId: string): FirestoreDashboardDocumentReference {
    assertSafeDocumentId(invitationId, "Invitation ID");
    return this.classroomReference(classroomId).collection("invites").doc(invitationId);
  }

  private studentMembershipReference(studentUid: string, classroomId: string): FirestoreDashboardDocumentReference {
    return this.studentMembershipCollection(studentUid).doc(classroomId);
  }

  private idempotencyReference(actorUid: string, action: string, correlationId: string): FirestoreDashboardDocumentReference {
    const key = createHash("sha256").update(`${actorUid}\0${action}\0${correlationId}`).digest("hex");
    return this.firestore.collection("mutationKeys").doc(key);
  }

  private auditReference(eventId: string): FirestoreDashboardDocumentReference {
    assertSafeDocumentId(eventId, "Audit event ID");
    return this.firestore.collection("auditEvents").doc(eventId);
  }
}

function profileFromSnapshot(snapshot: FirestoreDashboardDocumentSnapshot, expectedUid: string): DashboardProfileV2 {
  const data = snapshot.data();
  if (data === undefined) throw new Error("Persisted profile data is unavailable");
  const normalized = {
    ...data,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
  const canonical = DashboardProfileV2Schema.safeParse(normalized);
  const profile = canonical.success ? canonical.data : legacyProfileToCanonical(normalized);
  if (profile.firebaseUid !== expectedUid || snapshot.id !== expectedUid) {
    throw new Error("Persisted profile identity does not match the verified Firebase UID");
  }
  return profile;
}

function legacyProfileToCanonical(data: Record<string, unknown>): DashboardProfileV2 {
  const legacy = DashboardProfileSchema.parse(data);
  return DashboardProfileV2Schema.parse({
    internalProfileId: legacy.internalProfileId,
    firebaseUid: legacy.firebaseUid,
    verifiedEmail: null,
    displayName: null,
    roles: {
      ...(legacy.allowedRoles.includes("student") ? { student: "active" as const } : {}),
      ...(legacy.allowedRoles.includes("teacher") ? { teacher: "active" as const } : {}),
    },
    activeRole: legacy.activeRole,
    onboardingCompleted: legacy.onboardingCompleted,
    schemaVersion: 2,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
}

function classroomFromSnapshot(snapshot: FirestoreDashboardDocumentSnapshot): Classroom {
  const data = snapshot.data();
  if (data === undefined) throw new Error("Persisted classroom data is unavailable");
  const classroom = ClassroomSchema.parse(data);
  if (classroom.id !== snapshot.id) throw new Error("Persisted classroom identity does not match its document ID");
  return classroom;
}

function classroomsFromQuery(snapshot: FirestoreQuerySnapshot): Classroom[] {
  return snapshot.docs.map((document) => classroomFromSnapshot(document));
}

function invitationFromSnapshot(snapshot: FirestoreDashboardDocumentSnapshot): ClassroomInvite {
  const data = snapshot.data();
  if (data === undefined) throw new Error("Persisted invitation data is unavailable");
  const invitation = ClassroomInviteSchema.parse(data);
  const path = snapshot.ref.path.split("/");
  const physicalClassroomId = path.length === 4 && path[0] === "classrooms" && path[2] === "invites" ? path[1] : null;
  if (invitation.id !== snapshot.id
    || path[3] !== snapshot.id
    || physicalClassroomId === null
    || invitation.classroomId !== physicalClassroomId) {
    throw new DashboardStoreError("Invitation physical identity is inconsistent", "invitation_identity_collision");
  }
  return invitation;
}

function membershipFromProjection(
  snapshot: FirestoreDashboardDocumentSnapshot,
  expectedStudentUid: string,
  expectedClassroomId: string,
): ClassroomMembership {
  const data = snapshot.data();
  const parsed = ClassroomMembershipSchema.safeParse(data);
  if (!parsed.success
    || snapshot.id !== expectedClassroomId
    || parsed.data.classroomId !== expectedClassroomId
    || parsed.data.studentUid !== expectedStudentUid) {
    throw new DashboardStoreError("Student membership projection is invalid", "membership_projection_invalid");
  }
  return parsed.data;
}

function membershipFromClassroom(
  snapshot: FirestoreDashboardDocumentSnapshot,
  expectedClassroomId: string,
): ClassroomMembership {
  const parsed = ClassroomMembershipSchema.safeParse(snapshot.data());
  if (!parsed.success
    || snapshot.id !== parsed.data.studentUid
    || parsed.data.classroomId !== expectedClassroomId) {
    throw new DashboardStoreError("Classroom membership is invalid", "membership_projection_invalid");
  }
  return parsed.data;
}

function auditFromSnapshot(snapshot: FirestoreDashboardDocumentSnapshot): AuditEvent {
  const data = snapshot.data();
  if (data === undefined) throw new Error("Persisted audit data is unavailable");
  const event = AuditEventSchema.parse(data);
  if (event.id !== snapshot.id) throw new Error("Persisted audit identity does not match its document ID");
  return event;
}

function requireVerifiedEmail(principal: VerifiedPrincipal): asserts principal is VerifiedPrincipal & { email: string; emailVerified: true } {
  if (!principal.emailVerified || principal.email === null) {
    throw new DashboardStoreError("A verified email is required", "verified_email_required");
  }
}

function requireActiveAdmin(profile: DashboardProfileV2): void {
  if (profile.roles.admin !== "active") {
    throw new DashboardStoreError("An active Admin profile is required", "admin_required");
  }
}

function requireActiveTeacher(profile: DashboardProfileV2): void {
  if (profile.roles.teacher !== "active") {
    throw new DashboardStoreError("An active Teacher profile is required", "active_teacher_required");
  }
}

function requireOwnedClassroom(classroom: Classroom, ownerUid: string): void {
  if (classroom.ownerUid !== ownerUid) throw new DashboardStoreError("Classroom is outside the verified principal scope", "classroom_forbidden");
}

function requireOwnedActiveClassroom(classroom: Classroom, ownerUid: string): void {
  requireOwnedClassroom(classroom, ownerUid);
  if (classroom.status !== "active") throw new DashboardStoreError("Archived classrooms cannot receive invitations", "classroom_archived");
}

function invalidInvitation(): DashboardStoreError {
  return new DashboardStoreError("Invitation is unavailable", "invitation_invalid");
}

function invalidInvitationTransition(): DashboardStoreError {
  return new DashboardStoreError("Invitation transition is unavailable", "invitation_transition_invalid");
}

function boundedRosterLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new DashboardStoreError("Roster pagination is invalid", "pagination_cursor_invalid");
  return value;
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator);
  return `${local.slice(0, 1)}***${email.slice(separator)}`;
}

function boundedProviderMessageId(value: string): string {
  if (value.length < 1 || value.length > 240 || /[\r\n\0]/.test(value)) throw new Error("Provider message ID is invalid");
  return value;
}

function requiredReason(context: MutationContext): string {
  const reason = context.reason?.trim();
  if (!reason) throw new DashboardStoreError("A reason is required", "reason_required");
  return reason;
}

function changes(field: string, value: string | null): RedactedAuditChangeSet {
  return { count: 1, entries: [{ field, value }] };
}

function assertSafeDocumentId(value: string, label: string): void {
  if (!isSafeDocumentId(value)) throw new Error(`${label} must be a safe Firestore document ID`);
}

function isValidEmailIndex(data: Record<string, unknown> | undefined, normalizedEmail: string): data is {
  normalizedEmail: string;
  firebaseUid: string;
  createdAt: string;
  updatedAt: string;
} {
  if (data === undefined) return false;
  const keys = Object.keys(data).sort();
  return keys.length === 4
    && keys[0] === "createdAt"
    && keys[1] === "firebaseUid"
    && keys[2] === "normalizedEmail"
    && keys[3] === "updatedAt"
    && data.normalizedEmail === normalizedEmail
    && typeof data.firebaseUid === "string"
    && isIsoTimestamp(data.createdAt)
    && isIsoTimestamp(data.updatedAt);
}

function isIdempotencyKey(
  data: Record<string, unknown> | undefined,
  actorUid: string,
  action: string,
  correlationId: string,
  requestHash: string,
): data is Record<string, unknown> & { targetId: string } {
  if (data === undefined) return false;
  const keys = Object.keys(data).sort();
  return keys.length === 6
    && keys[0] === "action"
    && keys[1] === "actorUid"
    && keys[2] === "correlationId"
    && keys[3] === "createdAt"
    && keys[4] === "requestHash"
    && keys[5] === "targetId"
    && data.actorUid === actorUid
    && data.action === action
    && data.correlationId === correlationId
    && data.requestHash === requestHash
    && typeof data.targetId === "string"
    && isSafeDocumentId(data.targetId)
    && isIsoTimestamp(data.createdAt);
}

function isInvitationIdempotencyKey(
  data: Record<string, unknown> | undefined,
  actorUid: string,
  action: "invite.create" | "invite.redeliver",
  correlationId: string,
  requestHash: string,
): data is Record<string, unknown> & { classroomId: string; targetId: string } {
  if (data === undefined) return false;
  const keys = Object.keys(data).sort();
  return keys.length === 7
    && keys[0] === "action"
    && keys[1] === "actorUid"
    && keys[2] === "classroomId"
    && keys[3] === "correlationId"
    && keys[4] === "createdAt"
    && keys[5] === "requestHash"
    && keys[6] === "targetId"
    && data.actorUid === actorUid
    && data.action === action
    && data.correlationId === correlationId
    && data.requestHash === requestHash
    && typeof data.classroomId === "string"
    && isSafeDocumentId(data.classroomId)
    && typeof data.targetId === "string"
    && isSafeDocumentId(data.targetId)
    && isIsoTimestamp(data.createdAt);
}

function deliveryAttemptId(invitationId: string, tokenVersion: number): string {
  return `attempt-${createHash("sha256").update(`${invitationId}\0${tokenVersion}`).digest("hex").slice(0, 32)}`;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function timestampToIso(value: unknown): string {
  if (typeof value === "string") return new Date(value).toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  throw new Error("Persisted profile timestamp is invalid");
}

type CursorScope = "profiles" | "auditEvents" | "classrooms" | "invitations" | "teacherClassrooms" | "studentClassrooms" | "rosterMembers" | "rosterInvitations";

interface PageCursor {
  version: 1;
  scope: CursorScope;
  createdAt: string;
  id: string;
}

function encodeCursor(scope: CursorScope, createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, createdAt, id } satisfies PageCursor)).toString("base64url");
}

function decodeCursor(serialized: string, expectedScope: CursorScope): PageCursor {
  try {
    const decoded = Buffer.from(serialized, "base64url");
    if (decoded.toString("base64url") !== serialized) throw new Error("Non-canonical cursor encoding");
    const candidate: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof candidate !== "object" || candidate === null) throw new Error("Cursor is not an object");
    const cursor = candidate as Record<string, unknown>;
    const keys = Object.keys(cursor).sort();
    if (keys.length !== 4
      || keys[0] !== "createdAt"
      || keys[1] !== "id"
      || keys[2] !== "scope"
      || keys[3] !== "version"
      || cursor.version !== 1
      || cursor.scope !== expectedScope
      || !isIsoTimestamp(cursor.createdAt)
      || typeof cursor.id !== "string"
      || !isSafeDocumentId(cursor.id)) {
      throw new Error("Cursor fields are invalid");
    }
    return cursor as unknown as PageCursor;
  } catch {
    throw new DashboardStoreError("Pagination cursor is invalid", "pagination_cursor_invalid");
  }
}

function isSafeDocumentId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 128 && !value.includes("/") && ![...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}
