import { z } from "zod";

const MAX_ID_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const MAX_PAGE_SIZE = 100;
const MAX_RECIPIENTS = 500;

const IdentifierSchema = z.string().min(1).max(MAX_ID_LENGTH);
const IsoTimestampSchema = z.string().max(64).datetime({ offset: true });
const NormalizedEmailSchema = z.string().email().max(MAX_EMAIL_LENGTH).refine(
  (value) => value === value.trim().toLowerCase(),
  "Email must be normalized",
);
const BoundedTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum);

export const StudentStateSchema = z.enum(["active", "suspended"]);
export type StudentState = z.infer<typeof StudentStateSchema>;

export const TeacherStateSchema = z.enum(["pending", "active", "suspended", "rejected"]);
export type TeacherState = z.infer<typeof TeacherStateSchema>;

export const AdminStateSchema = z.enum(["active", "suspended"]);
export type AdminState = z.infer<typeof AdminStateSchema>;

export const ConnectedDashboardRoleSchema = z.enum(["student", "teacher", "admin"]);
export type ConnectedDashboardRole = z.infer<typeof ConnectedDashboardRoleSchema>;

export const DashboardRoleStatesSchema = z.object({
  student: StudentStateSchema.optional(),
  teacher: TeacherStateSchema.optional(),
  admin: AdminStateSchema.optional(),
}).strict();
export type DashboardRoleStates = z.infer<typeof DashboardRoleStatesSchema>;

export const VerifiedPrincipalSchema = z.object({
  uid: IdentifierSchema,
  email: NormalizedEmailSchema.nullable(),
  emailVerified: z.boolean(),
  displayName: BoundedTextSchema(160).nullable(),
  authTime: IsoTimestampSchema,
}).strict().superRefine((principal, context) => {
  if (principal.emailVerified && principal.email === null) {
    context.addIssue({ code: "custom", message: "A verified principal requires an email", path: ["email"] });
  }
});
export type VerifiedPrincipal = z.infer<typeof VerifiedPrincipalSchema>;

export const DashboardProfileV2Schema = z.object({
  internalProfileId: IdentifierSchema,
  firebaseUid: IdentifierSchema,
  verifiedEmail: NormalizedEmailSchema.nullable(),
  displayName: BoundedTextSchema(160).nullable(),
  roles: DashboardRoleStatesSchema,
  activeRole: ConnectedDashboardRoleSchema.nullable(),
  onboardingCompleted: z.boolean(),
  schemaVersion: z.literal(2),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((profile, context) => {
  if (profile.activeRole !== null && profile.roles[profile.activeRole] !== "active") {
    context.addIssue({ code: "custom", message: "The active role must be active", path: ["activeRole"] });
  }
});
export type DashboardProfileV2 = z.infer<typeof DashboardProfileV2Schema>;

export const AdminBootstrapConfigSchema = z.object({
  version: z.literal(1),
  verifiedEmails: z.array(NormalizedEmailSchema).max(MAX_RECIPIENTS).refine(
    (emails) => new Set(emails).size === emails.length,
    "verifiedEmails must be unique",
  ),
  firebaseUids: z.array(IdentifierSchema).max(MAX_RECIPIENTS).refine(
    (uids) => new Set(uids).size === uids.length,
    "firebaseUids must be unique",
  ),
}).strict();
export type AdminBootstrapConfig = z.infer<typeof AdminBootstrapConfigSchema>;

export const ClassroomStatusSchema = z.enum(["active", "archived"]);
export type ClassroomStatus = z.infer<typeof ClassroomStatusSchema>;

export const ClassroomSchema = z.object({
  id: IdentifierSchema,
  ownerUid: IdentifierSchema,
  name: BoundedTextSchema(120),
  status: ClassroomStatusSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict();
export type Classroom = z.infer<typeof ClassroomSchema>;

export const ClassroomInviteStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
export type ClassroomInviteStatus = z.infer<typeof ClassroomInviteStatusSchema>;

export const InviteDeliveryStateSchema = z.enum(["pending", "sent", "failed", "unknown", "redelivery_requested"]);
export type InviteDeliveryState = z.infer<typeof InviteDeliveryStateSchema>;

export const InviteDeliveryErrorCategorySchema = z.enum(["retryable", "permanent", "ambiguous"]);
export type InviteDeliveryErrorCategory = z.infer<typeof InviteDeliveryErrorCategorySchema>;

export const ClassroomInviteSchema = z.object({
  id: IdentifierSchema,
  classroomId: IdentifierSchema,
  ownerUid: IdentifierSchema,
  normalizedEmail: NormalizedEmailSchema,
  tokenDigest: z.string().min(32).max(256),
  tokenVersion: z.number().int().positive().max(1_000_000),
  expiresAt: IsoTimestampSchema,
  status: ClassroomInviteStatusSchema,
  delivery: InviteDeliveryStateSchema,
  deliveryErrorCategory: InviteDeliveryErrorCategorySchema.nullable().optional(),
  acceptedUid: IdentifierSchema.nullable(),
  acceptedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((invite, context) => {
  const accepted = invite.status === "accepted";
  if (accepted && (invite.acceptedUid === null || invite.acceptedAt === null)) {
    context.addIssue({ code: "custom", message: "Accepted invitations require acceptance metadata", path: ["acceptedUid"] });
  }
  if (!accepted && (invite.acceptedUid !== null || invite.acceptedAt !== null)) {
    context.addIssue({ code: "custom", message: "Only accepted invitations include acceptance metadata", path: ["acceptedUid"] });
  }
  const categoryAllowed = invite.delivery === "failed" || invite.delivery === "unknown";
  if (!categoryAllowed && invite.deliveryErrorCategory !== undefined && invite.deliveryErrorCategory !== null) {
    context.addIssue({ code: "custom", message: "Only failed or unknown delivery includes an error category", path: ["deliveryErrorCategory"] });
  }
  if (invite.delivery === "unknown" && invite.deliveryErrorCategory !== "ambiguous") {
    context.addIssue({ code: "custom", message: "Unknown delivery requires an ambiguous category", path: ["deliveryErrorCategory"] });
  }
  if (invite.delivery === "failed" && invite.deliveryErrorCategory === "ambiguous") {
    context.addIssue({ code: "custom", message: "Failed delivery cannot be ambiguous", path: ["deliveryErrorCategory"] });
  }
});
export type ClassroomInvite = z.infer<typeof ClassroomInviteSchema>;

export const ClassroomMembershipStatusSchema = z.enum(["active", "suspended"]);
export type ClassroomMembershipStatus = z.infer<typeof ClassroomMembershipStatusSchema>;

export const ClassroomMembershipSchema = z.object({
  classroomId: IdentifierSchema,
  studentUid: IdentifierSchema,
  sourceInviteId: IdentifierSchema,
  status: ClassroomMembershipStatusSchema,
  joinedAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict();
export type ClassroomMembership = z.infer<typeof ClassroomMembershipSchema>;

export const AssignmentStateSchema = z.enum(["creating", "active", "failed", "reconciliation_required", "archived"]);
export type AssignmentState = z.infer<typeof AssignmentStateSchema>;

export const AssignmentRecipientSnapshotSchema = z.object({
  uid: IdentifierSchema,
  email: NormalizedEmailSchema,
}).strict();
export type AssignmentRecipientSnapshot = z.infer<typeof AssignmentRecipientSnapshotSchema>;

export const AssignmentSolutionsSchema = z.enum(["never", "on_submit", "after_close"]);
export type AssignmentSolutions = z.infer<typeof AssignmentSolutionsSchema>;

export const AssignmentReconciliationSchema = z.object({
  reason: z.enum(["timeout", "disconnect", "malformed_success", "unknown"]),
  requiredAt: IsoTimestampSchema,
}).strict();
export type AssignmentReconciliation = z.infer<typeof AssignmentReconciliationSchema>;

const AssignmentBase = {
  id: IdentifierSchema,
  classroomId: IdentifierSchema,
  ownerUid: IdentifierSchema,
  jobId: IdentifierSchema,
  recipientSnapshot: z.array(AssignmentRecipientSnapshotSchema).min(1).max(MAX_RECIPIENTS).superRefine((recipients, context) => {
    const uids = new Set<string>();
    const emails = new Set<string>();
    recipients.forEach((recipient, index) => {
      if (uids.has(recipient.uid)) context.addIssue({ code: "custom", message: "Recipient UIDs must be unique", path: [index, "uid"] });
      if (emails.has(recipient.email)) context.addIssue({ code: "custom", message: "Recipient emails must be unique", path: [index, "email"] });
      uids.add(recipient.uid);
      emails.add(recipient.email);
    });
  }),
  openAt: IsoTimestampSchema,
  closeAt: IsoTimestampSchema.nullable(),
  solutions: AssignmentSolutionsSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
};

export const ClassroomAssignmentSchema = z.discriminatedUnion("state", [
  z.object({ ...AssignmentBase, state: z.literal("creating"), testId: z.null(), shareId: z.null(), runnerPath: z.null(), reconciliation: z.null() }).strict(),
  z.object({ ...AssignmentBase, state: z.literal("active"), testId: IdentifierSchema, shareId: IdentifierSchema, runnerPath: z.string().startsWith("/").max(512), reconciliation: z.null() }).strict(),
  z.object({ ...AssignmentBase, state: z.literal("failed"), testId: z.null(), shareId: z.null(), runnerPath: z.null(), reconciliation: z.null(), failureCode: z.string().min(1).max(64) }).strict(),
  z.object({ ...AssignmentBase, state: z.literal("reconciliation_required"), testId: z.null(), shareId: z.null(), runnerPath: z.null(), reconciliation: AssignmentReconciliationSchema }).strict(),
  z.object({ ...AssignmentBase, state: z.literal("archived"), testId: IdentifierSchema.nullable(), shareId: IdentifierSchema.nullable(), runnerPath: z.null(), reconciliation: z.null() }).strict(),
]).superRefine((assignment, context) => {
  if (assignment.solutions === "after_close" && assignment.closeAt === null) {
    context.addIssue({ code: "custom", message: "after_close solutions require a close time", path: ["closeAt"] });
  }
  if (assignment.closeAt !== null && Date.parse(assignment.closeAt) <= Date.parse(assignment.openAt)) {
    context.addIssue({ code: "custom", message: "closeAt must be after openAt", path: ["closeAt"] });
  }
});
export type ClassroomAssignment = z.infer<typeof ClassroomAssignmentSchema>;
const AssignmentProjectionBase = {
  id: IdentifierSchema,
  classroomId: IdentifierSchema,
  ownerUid: IdentifierSchema,
  jobId: IdentifierSchema,
  recipientCount: z.number().int().positive().max(MAX_RECIPIENTS),
  openAt: IsoTimestampSchema,
  closeAt: IsoTimestampSchema.nullable(),
  solutions: AssignmentSolutionsSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
};
export const ClassroomAssignmentProjectionSchema = z.discriminatedUnion("state", [
  z.object({ ...AssignmentProjectionBase, state: z.literal("creating"), testId: z.null(), shareId: z.null(), reconciliation: z.null() }).strict(),
  z.object({ ...AssignmentProjectionBase, state: z.literal("active"), testId: IdentifierSchema, shareId: IdentifierSchema, reconciliation: z.null() }).strict(),
  z.object({ ...AssignmentProjectionBase, state: z.literal("failed"), testId: z.null(), shareId: z.null(), reconciliation: z.null(), failureCode: z.string().min(1).max(64) }).strict(),
  z.object({ ...AssignmentProjectionBase, state: z.literal("reconciliation_required"), testId: z.null(), shareId: z.null(), reconciliation: AssignmentReconciliationSchema }).strict(),
  z.object({ ...AssignmentProjectionBase, state: z.literal("archived"), testId: IdentifierSchema.nullable(), shareId: IdentifierSchema.nullable(), reconciliation: z.null() }).strict(),
]).superRefine((assignment, context) => {
  if (assignment.solutions === "after_close" && assignment.closeAt === null) {
    context.addIssue({ code: "custom", message: "after_close solutions require a close time", path: ["closeAt"] });
  }
  if (assignment.closeAt !== null && Date.parse(assignment.closeAt) <= Date.parse(assignment.openAt)) {
    context.addIssue({ code: "custom", message: "closeAt must be after openAt", path: ["closeAt"] });
  }
});
export type ClassroomAssignmentProjection = z.infer<typeof ClassroomAssignmentProjectionSchema>;

export const AuditActionSchema = z.enum([
  "admin.bootstrap",
  "profile.onboarded",
  "profile.active_role_changed",
  "teacher.approved",
  "teacher.suspended",
  "classroom.created",
  "classroom.archived",
  "classroom.restored",
  "invite.created",
  "invite.delivery_started",
  "invite.delivery_sent",
  "invite.delivery_failed",
  "invite.delivery_unknown",
  "invite.revoked",
  "invite.redelivery_requested",
  "invite.redelivered",
  "invite.accepted",
  "assignment.created",
  "assignment.activated",
  "assignment.failed",
  "assignment.reconciliation_required",
  "assignment.reconciled",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const RedactedAuditChangeEntrySchema = z.object({
  field: z.string().min(1).max(64),
  value: z.string().max(240).nullable(),
}).strict();
export type RedactedAuditChangeEntry = z.infer<typeof RedactedAuditChangeEntrySchema>;

export const RedactedAuditChangeSetSchema = z.object({
  count: z.number().int().nonnegative().max(50),
  entries: z.array(RedactedAuditChangeEntrySchema).max(50),
}).strict().superRefine((changes, context) => {
  if (changes.count !== changes.entries.length) {
    context.addIssue({ code: "custom", message: "count must equal the number of entries", path: ["count"] });
  }
});
export type RedactedAuditChangeSet = z.infer<typeof RedactedAuditChangeSetSchema>;

export const AuditEventSchema = z.object({
  id: IdentifierSchema,
  actorUid: IdentifierSchema,
  actorProfileId: IdentifierSchema,
  action: AuditActionSchema,
  targetType: z.enum(["profile", "classroom", "invite", "assignment"]),
  targetId: IdentifierSchema,
  reason: BoundedTextSchema(500).nullable(),
  correlationId: z.string().uuid(),
  before: RedactedAuditChangeSetSchema.optional(),
  after: RedactedAuditChangeSetSchema.optional(),
  canonicalLogInsertId: z.string().min(1).max(128),
  createdAt: IsoTimestampSchema,
}).strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const PaginationRequestSchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().positive().max(MAX_PAGE_SIZE).default(50),
}).strict();
export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;

export const DashboardProfileResponseSchema = z.object({ profile: DashboardProfileV2Schema }).strict();
export type DashboardProfileResponse = z.infer<typeof DashboardProfileResponseSchema>;

export const DashboardProfileOnboardRequestSchema = z.object({
  role: z.enum(["student", "teacher"]),
}).strict();
export type DashboardProfileOnboardRequest = z.infer<typeof DashboardProfileOnboardRequestSchema>;

export const UpdateActiveRoleRequestSchema = z.object({
  activeRole: ConnectedDashboardRoleSchema,
}).strict();
export type UpdateActiveRoleRequest = z.infer<typeof UpdateActiveRoleRequestSchema>;

export const CreateClassroomRequestSchema = z.object({ name: BoundedTextSchema(120) }).strict();
export type CreateClassroomRequest = z.infer<typeof CreateClassroomRequestSchema>;
export const ClassroomResponseSchema = z.object({ classroom: ClassroomSchema }).strict();
export type ClassroomResponse = z.infer<typeof ClassroomResponseSchema>;
export const ClassroomListResponseSchema = z.object({ classrooms: z.array(ClassroomSchema).max(MAX_PAGE_SIZE), nextCursor: z.string().max(512).nullable() }).strict();
export type ClassroomListResponse = z.infer<typeof ClassroomListResponseSchema>;

export const InviteClassroomMemberRequestSchema = z.object({
  email: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
    NormalizedEmailSchema,
  ),
}).strict();
export type InviteClassroomMemberRequest = z.infer<typeof InviteClassroomMemberRequestSchema>;
export const ClassroomInviteProjectionSchema = z.object({
  id: IdentifierSchema,
  classroomId: IdentifierSchema,
  ownerUid: IdentifierSchema,
  tokenVersion: z.number().int().positive().max(1_000_000),
  expiresAt: IsoTimestampSchema,
  status: ClassroomInviteStatusSchema,
  delivery: InviteDeliveryStateSchema,
  deliveryErrorCategory: InviteDeliveryErrorCategorySchema.nullable().optional(),
  acceptedUid: IdentifierSchema.nullable(),
  acceptedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((invite, context) => {
  if (invite.delivery === "unknown" && invite.deliveryErrorCategory !== "ambiguous") {
    context.addIssue({ code: "custom", message: "Unknown delivery requires an ambiguous category", path: ["deliveryErrorCategory"] });
  }
  if (invite.delivery !== "failed" && invite.delivery !== "unknown" && invite.deliveryErrorCategory != null) {
    context.addIssue({ code: "custom", message: "Delivery error category is unavailable for this state", path: ["deliveryErrorCategory"] });
  }
});
export type ClassroomInviteProjection = z.infer<typeof ClassroomInviteProjectionSchema>;
export const ClassroomInviteResponseSchema = z.object({ invite: ClassroomInviteProjectionSchema }).strict();
export type ClassroomInviteResponse = z.infer<typeof ClassroomInviteResponseSchema>;

export const ClassroomRosterMemberSchema = z.object({
  studentUid: IdentifierSchema,
  displayName: BoundedTextSchema(160).nullable(),
  status: ClassroomMembershipStatusSchema,
  joinedAt: IsoTimestampSchema,
}).strict();
export type ClassroomRosterMember = z.infer<typeof ClassroomRosterMemberSchema>;

export const ClassroomRosterInvitationSchema = z.object({
  id: IdentifierSchema,
  maskedEmail: z.string().min(3).max(MAX_EMAIL_LENGTH),
  expiresAt: IsoTimestampSchema,
  status: ClassroomInviteStatusSchema,
  delivery: InviteDeliveryStateSchema,
  deliveryErrorCategory: InviteDeliveryErrorCategorySchema.nullable().optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((invite, context) => {
  if (invite.delivery === "unknown" && invite.deliveryErrorCategory !== "ambiguous") {
    context.addIssue({ code: "custom", message: "Unknown delivery requires an ambiguous category", path: ["deliveryErrorCategory"] });
  }
  if (invite.delivery !== "failed" && invite.delivery !== "unknown" && invite.deliveryErrorCategory != null) {
    context.addIssue({ code: "custom", message: "Delivery error category is unavailable for this state", path: ["deliveryErrorCategory"] });
  }
});
export type ClassroomRosterInvitation = z.infer<typeof ClassroomRosterInvitationSchema>;

export const ClassroomRosterResponseSchema = z.object({
  members: z.array(ClassroomRosterMemberSchema).max(MAX_PAGE_SIZE),
  invitations: z.array(ClassroomRosterInvitationSchema).max(MAX_PAGE_SIZE),
  nextMemberCursor: z.string().max(512).nullable(),
  nextInvitationCursor: z.string().max(512).nullable(),
}).strict();
export type ClassroomRosterResponse = z.infer<typeof ClassroomRosterResponseSchema>;

export const InspectInvitationRequestSchema = z.object({ token: z.string().min(1).max(1024) }).strict();
export type InspectInvitationRequest = z.infer<typeof InspectInvitationRequestSchema>;
export const InspectInvitationResponseSchema = z.object({
  inviteId: IdentifierSchema,
  classroomId: IdentifierSchema,
  classroomName: BoundedTextSchema(120),
  teacherDisplayName: BoundedTextSchema(160),
  targetEmailMatches: z.boolean(),
  studentOnboardingRequired: z.boolean(),
  expiresAt: IsoTimestampSchema,
  status: ClassroomInviteStatusSchema,
}).strict();
export type InspectInvitationResponse = z.infer<typeof InspectInvitationResponseSchema>;
export const AcceptInvitationRequestSchema = InspectInvitationRequestSchema;
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;
export const AcceptInvitationResponseSchema = z.object({ membership: ClassroomMembershipSchema }).strict();
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const CreateClassroomAssignmentRequestSchema = z.object({
  jobId: IdentifierSchema,
  openAt: IsoTimestampSchema,
  closeAt: IsoTimestampSchema.nullable(),
  solutions: AssignmentSolutionsSchema,
}).strict();
export type CreateClassroomAssignmentRequest = z.infer<typeof CreateClassroomAssignmentRequestSchema>;
export const ClassroomAssignmentResponseSchema = z.object({ assignment: ClassroomAssignmentProjectionSchema }).strict();
export type ClassroomAssignmentResponse = z.infer<typeof ClassroomAssignmentResponseSchema>;
export const ClassroomAssignmentListResponseSchema = z.object({ assignments: z.array(ClassroomAssignmentProjectionSchema).max(MAX_PAGE_SIZE), nextCursor: z.string().max(512).nullable() }).strict();
export type ClassroomAssignmentListResponse = z.infer<typeof ClassroomAssignmentListResponseSchema>;

export const AssignmentLaunchResponseSchema = z.object({ runnerPath: z.string().startsWith("/").max(512) }).strict();
export type AssignmentLaunchResponse = z.infer<typeof AssignmentLaunchResponseSchema>;
export const AssignmentAggregateInsightSchema = z.object({
  attempted: z.number().int().nonnegative().max(MAX_RECIPIENTS),
  pending: z.number().int().nonnegative().max(MAX_RECIPIENTS),
  averageScore: z.number().finite().min(-1_000_000).max(1_000_000),
}).strict();
export type AssignmentAggregateInsight = z.infer<typeof AssignmentAggregateInsightSchema>;

export const AssignmentIndividualInsightSchema = z.object({
  uid: IdentifierSchema,
  displayName: BoundedTextSchema(160),
  score: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
  status: z.enum(["attempted", "pending"]),
}).strict();
export type AssignmentIndividualInsight = z.infer<typeof AssignmentIndividualInsightSchema>;

export const AssignmentPersonalInsightSchema = z.object({
  attempted: z.number().int().nonnegative().max(MAX_RECIPIENTS),
  averageScore: z.number().finite().min(-1_000_000).max(1_000_000),
  score: z.number().finite().min(-1_000_000).max(1_000_000),
  latestScore: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
}).strict();
export type AssignmentPersonalInsight = z.infer<typeof AssignmentPersonalInsightSchema>;

export const AssignmentInsightsResponseSchema = z.object({
  freshness: IsoTimestampSchema,
  insights: z.object({
    aggregate: AssignmentAggregateInsightSchema.optional(),
    individual: AssignmentIndividualInsightSchema.optional(),
    personal: AssignmentPersonalInsightSchema.optional(),
  }).strict().refine(
    (insights) => insights.aggregate !== undefined || insights.individual !== undefined || insights.personal !== undefined,
    "At least one projected insight is required",
  ),
}).strict();
export type AssignmentInsightsResponse = z.infer<typeof AssignmentInsightsResponseSchema>;
export const ReconcileAssignmentRequestSchema = z.object({
  resolution: z.enum(["link_existing_share", "retry_confirmed_absent"]),
  shareId: IdentifierSchema.optional(),
  reason: BoundedTextSchema(500),
}).strict().superRefine((request, context) => {
  if (request.resolution === "link_existing_share" && request.shareId === undefined) {
    context.addIssue({ code: "custom", message: "An existing share ID is required", path: ["shareId"] });
  }
  if (request.resolution === "retry_confirmed_absent" && request.shareId !== undefined) {
    context.addIssue({ code: "custom", message: "A retry cannot include a share ID", path: ["shareId"] });
  }
});
export type ReconcileAssignmentRequest = z.infer<typeof ReconcileAssignmentRequestSchema>;

const V3BoundedLabelSchema = z.string().trim().min(1).max(240);
const V3EpochSecondsSchema = z.number().finite().nonnegative().max(10_000_000_000);
const V3NullableScoreSchema = z.number().finite().min(-1_000_000).max(1_000_000).nullable();
const V3_SCHEDULE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.000)?(Z|([+-])(\d{2}):(\d{2}))$/;
export const V3ScheduleTimestampSchema = z.string().max(64).superRefine((value, context) => {
  const match = V3_SCHEDULE_PATTERN.exec(value);
  if (!match) {
    context.addIssue({ code: "custom", message: "Expected a canonical integral RFC3339 timestamp" });
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  const unknownOffset = match[7] === "-00:00";
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const validFields = year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59
    && !unknownOffset && offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
  const epochSeconds = Date.parse(value) / 1000;
  if (!validFields || !Number.isInteger(epochSeconds) || epochSeconds < 0 || epochSeconds > 10_000_000_000) {
    context.addIssue({ code: "custom", message: "Timestamp is invalid or outside the supported V3 schedule range" });
  }
});
export type V3ScheduleTimestamp = z.infer<typeof V3ScheduleTimestampSchema>;
const V3RunnerPathSchema = z.string().min(4).max(512).refine(
  (path) => /^\/t\/[A-Za-z0-9_-]{16,256}$/.test(path),
  "Runner path must be a safe V3 test capability path",
);

export const V3OwnedJobSchema = z.object({
  id: IdentifierSchema,
  title: V3BoundedLabelSchema,
  status: z.enum(["draft", "in_review", "revising", "final"]),
  grade: z.union([z.string().trim().max(32), z.number().finite()]).optional(),
  createdAt: z.union([IsoTimestampSchema, V3EpochSecondsSchema]).optional(),
  updatedAt: z.union([IsoTimestampSchema, V3EpochSecondsSchema]).optional(),
}).strict();
export type V3OwnedJob = z.infer<typeof V3OwnedJobSchema>;

export const V3OwnedJobsSchema = z.object({
  jobs: z.array(V3OwnedJobSchema).max(MAX_PAGE_SIZE),
  page: z.number().int().positive().max(1_000_000),
  pageSize: z.number().int().positive().max(50),
  total: z.number().int().nonnegative().max(10_000_000),
  pages: z.number().int().nonnegative().max(1_000_000),
}).strict();
export type V3OwnedJobs = z.infer<typeof V3OwnedJobsSchema>;

export const V3ShareResultSchema = z.object({
  shareId: IdentifierSchema,
  testId: IdentifierSchema,
  runnerPath: V3RunnerPathSchema,
  readout: z.object({
    resolved: z.number().int().nonnegative().max(MAX_RECIPIENTS),
    batches: z.number().int().nonnegative().max(MAX_RECIPIENTS),
    warnings: z.array(z.string().trim().min(1).max(240)).max(20),
  }).strict(),
}).strict();
export type V3ShareResult = z.infer<typeof V3ShareResultSchema>;

export const V3ShareStudentResultSchema = z.object({
  uid: IdentifierSchema.nullable(),
  attempted: z.boolean(),
  score: V3NullableScoreSchema,
  maxScore: V3NullableScoreSchema,
  accuracy: z.number().finite().min(0).max(1).nullable(),
  timeMs: z.number().int().nonnegative().max(86_400_000).nullable(),
}).strict();
export const V3ShareResultsSchema = z.object({
  shareId: IdentifierSchema,
  testId: IdentifierSchema,
  funnel: z.object({
    shared: z.number().int().nonnegative().max(MAX_RECIPIENTS),
    attempted: z.number().int().nonnegative().max(MAX_RECIPIENTS),
    pending: z.number().int().nonnegative().max(MAX_RECIPIENTS),
  }).strict(),
  averageScore: V3NullableScoreSchema,
  students: z.array(V3ShareStudentResultSchema).max(MAX_RECIPIENTS),
}).strict();
export type V3ShareResults = z.infer<typeof V3ShareResultsSchema>;

export const V3IndividualTestInsightSchema = z.object({
  uid: IdentifierSchema,
  testId: IdentifierSchema,
  available: z.boolean(),
  title: V3BoundedLabelSchema.nullable(),
  score: V3NullableScoreSchema,
  maxScore: V3NullableScoreSchema,
  percentile: z.number().finite().min(0).max(100).nullable(),
  deltaFromPrevious: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
}).strict();
export type V3IndividualTestInsight = z.infer<typeof V3IndividualTestInsightSchema>;

export const V3StudentTestCardSchema = z.object({
  testId: IdentifierSchema,
  title: V3BoundedLabelSchema,
  teacherLabel: V3BoundedLabelSchema,
  kind: z.string().trim().min(1).max(32),
  sharedAtEpochSeconds: V3EpochSecondsSchema,
  state: z.string().trim().min(1).max(32),
  score: V3NullableScoreSchema,
  maxScore: V3NullableScoreSchema,
  runnerPath: V3RunnerPathSchema.nullable(),
}).strict();
export const V3StudentTestListSchema = z.object({
  tests: z.array(V3StudentTestCardSchema).max(MAX_RECIPIENTS),
}).strict();
export type V3StudentTestList = z.infer<typeof V3StudentTestListSchema>;

export const V3StudentTestReadSchema = z.object({
  testId: IdentifierSchema,
  title: V3BoundedLabelSchema,
  kind: z.string().trim().min(1).max(32),
  durationMinutes: z.number().int().positive().max(1_440),
  sectionCount: z.number().int().nonnegative().max(100),
  window: z.object({ open: V3EpochSecondsSchema.nullable(), close: V3EpochSecondsSchema.nullable() }).strict().nullable(),
}).strict();
export type V3StudentTestRead = z.infer<typeof V3StudentTestReadSchema>;

export const V3StudentAttemptSummarySchema = z.object({
  testId: IdentifierSchema,
  title: V3BoundedLabelSchema.nullable(),
  score: V3NullableScoreSchema,
  maxScore: V3NullableScoreSchema,
  attemptedAt: IsoTimestampSchema.nullable(),
}).strict();
export const V3StudentAttemptsSchema = z.object({ attempts: z.array(V3StudentAttemptSummarySchema).max(MAX_RECIPIENTS) }).strict();
export type V3StudentAttempts = z.infer<typeof V3StudentAttemptsSchema>;

export const V3StudentTestReviewSchema = z.object({
  testId: IdentifierSchema,
  available: z.boolean(),
  locked: z.boolean(),
  score: V3NullableScoreSchema,
  maxScore: V3NullableScoreSchema,
  solutionsHidden: z.string().trim().min(1).max(240).nullable(),
}).strict();
export type V3StudentTestReview = z.infer<typeof V3StudentTestReviewSchema>;

export const V3StudentOverallInsightSchema = z.object({
  available: z.boolean(),
  message: z.string().trim().min(1).max(240).nullable(),
  testCount: z.number().int().nonnegative().max(1_000_000),
  readinessMarks: z.number().finite().min(0).max(1_000_000).nullable(),
  readinessOf: z.number().finite().positive().max(1_000_000).nullable(),
  readinessPercentile: z.number().finite().min(0).max(100).nullable(),
  growthVerdict: z.string().trim().min(1).max(64).nullable(),
  growthPerTest: z.number().finite().min(-100).max(100).nullable(),
}).strict();
export type V3StudentOverallInsight = z.infer<typeof V3StudentOverallInsightSchema>;

export const AdminReasonRequestSchema = z.object({ reason: BoundedTextSchema(500) }).strict();
export type AdminReasonRequest = z.infer<typeof AdminReasonRequestSchema>;
export const AdminProfileListResponseSchema = z.object({ profiles: z.array(DashboardProfileV2Schema).max(MAX_PAGE_SIZE), nextCursor: z.string().max(512).nullable() }).strict();
export type AdminProfileListResponse = z.infer<typeof AdminProfileListResponseSchema>;
export const AdminInvitationListResponseSchema = z.object({ invitations: z.array(ClassroomInviteProjectionSchema).max(MAX_PAGE_SIZE), nextCursor: z.string().max(512).nullable() }).strict();
export type AdminInvitationListResponse = z.infer<typeof AdminInvitationListResponseSchema>;
export const AdminAuditListResponseSchema = z.object({ events: z.array(AuditEventSchema).max(MAX_PAGE_SIZE), nextCursor: z.string().max(512).nullable() }).strict();
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(240),
    correlationId: z.string().uuid(),
    retryable: z.boolean(),
  }).strict(),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

// Short aliases keep route code readable while preserving the Dashboard-prefixed
// names that avoid collisions with the existing V3 contracts.
export const OnboardProfileRequestSchema = DashboardProfileOnboardRequestSchema;
export const SetActiveRoleRequestSchema = UpdateActiveRoleRequestSchema;
