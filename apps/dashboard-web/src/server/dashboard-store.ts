import type {
  AdminBootstrapConfig,
  AuditEvent,
  Classroom,
  ClassroomAssignment,
  ClassroomInvite,
  ClassroomMembership,
  ClassroomRosterResponse,
  ConnectedDashboardRole,
  CreateClassroomAssignmentRequest,
  CreateClassroomRequest,
  DashboardProfileOnboardRequest,
  DashboardProfileV2,
  PaginationRequest,
  VerifiedPrincipal,
} from "@vijeeta/api-contracts";

export interface MutationContext {
  now: string;
  correlationId: string;
  reason?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProfileRepository {
  getProfile(firebaseUid: string): Promise<DashboardProfileV2 | null>;
  onboard(
    principal: VerifiedPrincipal,
    input: DashboardProfileOnboardRequest,
    context: MutationContext,
  ): Promise<DashboardProfileV2>;
  setActiveRole(
    principal: VerifiedPrincipal,
    activeRole: ConnectedDashboardRole,
    context: MutationContext,
  ): Promise<DashboardProfileV2>;
  bootstrapAdmin(
    principal: VerifiedPrincipal,
    config: AdminBootstrapConfig,
    context?: MutationContext,
  ): Promise<DashboardProfileV2>;
}

export interface AdminRepository {
  listProfiles(principal: VerifiedPrincipal, page: PaginationRequest): Promise<Page<DashboardProfileV2>>;
  approveTeacher(
    principal: VerifiedPrincipal,
    targetUid: string,
    context: MutationContext,
  ): Promise<DashboardProfileV2>;
  suspendTeacher(
    principal: VerifiedPrincipal,
    targetUid: string,
    context: MutationContext,
  ): Promise<DashboardProfileV2>;
}

export interface AdminClassroomRepository {
  listClassrooms(principal: VerifiedPrincipal, page: PaginationRequest): Promise<Page<Classroom>>;
}

export interface AdminInvitationRepository {
  listInvitations(principal: VerifiedPrincipal, page: PaginationRequest): Promise<Page<ClassroomInvite>>;
  getInvitationById(principal: VerifiedPrincipal, invitationId: string): Promise<ClassroomInvite | null>;
  revokeInvitationById(
    principal: VerifiedPrincipal,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
  requestInvitationRedelivery(
    principal: VerifiedPrincipal,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
}

export interface ClassroomRepository {
  create(
    principal: VerifiedPrincipal,
    input: CreateClassroomRequest,
    context: MutationContext,
  ): Promise<Classroom>;
  getClassroom(principal: VerifiedPrincipal, classroomId: string): Promise<Classroom | null>;
  listForPrincipal(principal: VerifiedPrincipal): Promise<Classroom[]>;
  archive(
    principal: VerifiedPrincipal,
    classroomId: string,
    context: MutationContext,
  ): Promise<Classroom>;
  restore(
    principal: VerifiedPrincipal,
    classroomId: string,
    context: MutationContext,
  ): Promise<Classroom>;
}

export interface PaginatedClassroomRepository extends ClassroomRepository {
  listForPrincipalPage(principal: VerifiedPrincipal, page: PaginationRequest): Promise<Page<Classroom>>;
  archiveOwned(principal: VerifiedPrincipal, classroomId: string, context: MutationContext): Promise<Classroom>;
}

export type CreateInvitationInput = Pick<
  ClassroomInvite,
  "id" | "classroomId" | "normalizedEmail" | "tokenDigest" | "tokenVersion" | "expiresAt"
>;

export interface InvitationDispatch {
  invite: ClassroomInvite;
  classroomName: string;
  teacherName: string;
  teacherEmail: string;
}

export interface InvitationInspection extends InvitationDispatch {
  studentOnboardingRequired: boolean;
}

export interface RosterPagination {
  limit: number;
  memberCursor?: string;
  invitationCursor?: string;
}

export interface InvitationAcceptanceInput {
  classroomId: string;
  invitationId: string;
  expectedTokenDigest: string;
  expectedTokenVersion: number;
}

export interface InvitationDeliveryOutcome {
  status: "sent" | "failed" | "unknown";
  provider: "capture" | "smtp";
  providerMessageId?: string;
  category?: "authentication_rejected" | "transport_pre_data" | "recipient_rejected" | "delivery_ambiguous";
  retryable?: boolean;
}

export type InvitationCreationResult =
  | { disposition: "created"; invite: ClassroomInvite }
  | { disposition: "idempotent_replay"; invite: ClassroomInvite };

export type InvitationRotationResult =
  | { disposition: "rotated"; invite: ClassroomInvite }
  | { disposition: "idempotent_replay"; invite: ClassroomInvite };

export interface InvitationTokenBinding {
  tokenDigest: string;
  tokenVersion: number;
}

export interface InvitationRepository {
  getInvitation(classroomId: string, invitationId: string): Promise<ClassroomInvite | null>;
  inspectInvitation(principal: VerifiedPrincipal, invitationId: string): Promise<InvitationInspection>;
  resolveInvitationForAcceptance(principal: VerifiedPrincipal, invitationId: string): Promise<InvitationInspection>;
  listRoster(principal: VerifiedPrincipal, classroomId: string, page: RosterPagination): Promise<ClassroomRosterResponse>;
  createInvitation(
    principal: VerifiedPrincipal,
    input: CreateInvitationInput,
    context: MutationContext,
  ): Promise<InvitationCreationResult>;
  beginInvitationDelivery(
    principal: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    provider: "capture" | "smtp",
    expectedToken: InvitationTokenBinding,
    context: MutationContext,
  ): Promise<{ attemptId: string; dispatch: InvitationDispatch }>;
  completeInvitationDelivery(
    principal: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    attemptId: string,
    outcome: InvitationDeliveryOutcome,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
  rotateInvitation(
    principal: VerifiedPrincipal,
    input: CreateInvitationInput,
    context: MutationContext,
  ): Promise<InvitationRotationResult>;
  revokeInvitation(
    principal: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
  acceptInvitation(
    principal: VerifiedPrincipal,
    input: InvitationAcceptanceInput,
    context: MutationContext,
  ): Promise<ClassroomMembership>;
}

export interface CreateAssignmentInput {
  classroomId: string;
  request: CreateClassroomAssignmentRequest;
  idempotencyKey: string;
}

export type AssignmentPreparationResult =
  | { disposition: "created"; assignment: ClassroomAssignment }
  | { disposition: "idempotent_replay"; assignment: ClassroomAssignment };

export type AssignmentCompletion =
  | { kind: "active"; shareId: string; testId: string; runnerPath: string }
  | { kind: "failed"; failureCode: string }
  | { kind: "reconciliation_required"; reason: "timeout" | "disconnect" | "malformed_success" | "unknown" };

export interface AssignmentRepository {
  getAssignment(classroomId: string, assignmentId: string): Promise<ClassroomAssignment | null>;
  prepareAssignment(
    principal: VerifiedPrincipal,
    input: CreateAssignmentInput,
    context: MutationContext,
  ): Promise<AssignmentPreparationResult>;
  claimAssignmentShare(principal: VerifiedPrincipal, assignmentId: string, context: MutationContext): Promise<
    { status: "claimed"; operationId: string; assignment: ClassroomAssignment }
    | { status: "already_claimed"; assignment: ClassroomAssignment }
  >;
  completeAssignmentShare(
    principal: VerifiedPrincipal,
    assignmentId: string,
    operationId: string,
    completion: AssignmentCompletion,
    context: MutationContext,
  ): Promise<ClassroomAssignment>;
  listAssignmentsForPrincipalPage(
    principal: VerifiedPrincipal,
    classroomId: string,
    page: PaginationRequest,
  ): Promise<Page<ClassroomAssignment>>;
  getOwnedAssignment(principal: VerifiedPrincipal, assignmentId: string): Promise<ClassroomAssignment | null>;
  getAssignmentForStudent(principal: VerifiedPrincipal, assignmentId: string): Promise<ClassroomAssignment | null>;
}

export interface AuditRepository {
  listAuditEvents(principal: VerifiedPrincipal, page: PaginationRequest): Promise<Page<AuditEvent>>;
}

export type DashboardStoreErrorCode =
  | "active_teacher_required"
  | "admin_required"
  | "bootstrap_identity_mismatch"
  | "classroom_forbidden"
  | "classroom_not_found"
  | "classroom_transition_invalid"
  | "classroom_archived"
  | "email_index_collision"
  | "email_index_invalid"
  | "invitation_identity_collision"
  | "invitation_not_found"
  | "invitation_transition_invalid"
  | "invitation_invalid"
  | "idempotency_conflict"
  | "rate_limited"
  | "student_role_required"
  | "membership_projection_invalid"
  | "assignment_not_found"
  | "assignment_forbidden"
  | "assignment_transition_invalid"
  | "assignment_identity_collision"
  | "assignment_projection_invalid"
  | "assignment_recipients_unavailable"
  | "pagination_cursor_invalid"
  | "profile_exists"
  | "profile_not_found"
  | "reason_required"
  | "role_not_active"
  | "teacher_transition_invalid"
  | "verified_email_changed"
  | "verified_email_required";

export class DashboardStoreError extends Error {
  constructor(
    message: string,
    readonly code: DashboardStoreErrorCode,
  ) {
    super(message);
    this.name = "DashboardStoreError";
  }
}
