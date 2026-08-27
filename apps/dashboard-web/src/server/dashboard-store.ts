import type {
  AdminBootstrapConfig,
  AuditEvent,
  Classroom,
  ClassroomAssignment,
  ClassroomInvite,
  ClassroomMembership,
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

export type CreateInvitationInput = Pick<
  ClassroomInvite,
  "classroomId" | "normalizedEmail" | "tokenDigest" | "tokenVersion" | "expiresAt"
>;

export interface InvitationRepository {
  getInvitation(classroomId: string, invitationId: string): Promise<ClassroomInvite | null>;
  createInvitation(
    principal: VerifiedPrincipal,
    input: CreateInvitationInput,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
  revokeInvitation(
    principal: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomInvite>;
  acceptInvitation(
    principal: VerifiedPrincipal,
    classroomId: string,
    invitationId: string,
    context: MutationContext,
  ): Promise<ClassroomMembership>;
}

export interface CreateAssignmentInput {
  classroomId: string;
  request: CreateClassroomAssignmentRequest;
  recipientSnapshot: ClassroomAssignment["recipientSnapshot"];
}

export interface AssignmentRepository {
  getAssignment(classroomId: string, assignmentId: string): Promise<ClassroomAssignment | null>;
  createAssignment(
    principal: VerifiedPrincipal,
    input: CreateAssignmentInput,
    context: MutationContext,
  ): Promise<ClassroomAssignment>;
  listAssignmentsForPrincipal(
    principal: VerifiedPrincipal,
    classroomId: string,
  ): Promise<ClassroomAssignment[]>;
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
  | "email_index_collision"
  | "email_index_invalid"
  | "membership_projection_invalid"
  | "pagination_cursor_invalid"
  | "profile_exists"
  | "profile_not_found"
  | "reason_required"
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
