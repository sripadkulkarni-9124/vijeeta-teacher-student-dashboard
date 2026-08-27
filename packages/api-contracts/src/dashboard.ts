import { z } from "zod";

export const DashboardRoleSchema = z.enum(["teacher", "student"]);
export type DashboardRole = z.infer<typeof DashboardRoleSchema>;

export const DashboardSessionSchema = z.object({
  role: DashboardRoleSchema,
  userId: z.string().min(1),
  displayName: z.string().min(1),
  organisationId: z.string().min(1),
}).strict();
export type DashboardSession = z.infer<typeof DashboardSessionSchema>;

export const TeacherDashboardSessionSchema = DashboardSessionSchema.extend({ role: z.literal("teacher") });
export type TeacherDashboardSession = z.infer<typeof TeacherDashboardSessionSchema>;
export const StudentDashboardSessionSchema = DashboardSessionSchema.extend({ role: z.literal("student") });
export type StudentDashboardSession = z.infer<typeof StudentDashboardSessionSchema>;

export const DashboardOrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}).strict();
export type DashboardOrganisation = z.infer<typeof DashboardOrganisationSchema>;

export const DashboardRosterStudentSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
  status: z.enum(["active", "invited", "suspended"]),
}).strict();
export type DashboardRosterStudent = z.infer<typeof DashboardRosterStudentSchema>;

export const DashboardClassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subject: z.string().min(1),
  roster: z.array(DashboardRosterStudentSchema),
}).strict();
export type DashboardClass = z.infer<typeof DashboardClassSchema>;

export const DashboardInviteSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  classId: z.string().min(1),
  status: z.enum(["pending", "accepted", "expired"]),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type DashboardInvite = z.infer<typeof DashboardInviteSchema>;

export const QuickTestDifficultySchema = z.enum(["easy", "medium", "hard", "mixed"]);
export type QuickTestDifficulty = z.infer<typeof QuickTestDifficultySchema>;

export const ReleasePolicySchema = z.union([
  z.enum(["learning-mode", "after-test"]),
  z.object({ kind: z.literal("scheduled"), releaseAt: z.string().datetime({ offset: true }) }).strict(),
]);
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;

export const DashboardQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }).strict()).min(1),
  marks: z.number().int().positive(),
}).strict();
export type DashboardQuestion = z.infer<typeof DashboardQuestionSchema>;

export const QuickTestDraftSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  questionCount: z.number().int().positive().max(100),
  difficulty: QuickTestDifficultySchema,
  durationMinutes: z.number().int().positive().max(240),
  negativeMarking: z.boolean(),
  releasePolicy: ReleasePolicySchema,
  status: z.literal("draft"),
  createdAt: z.string().datetime({ offset: true }),
  questions: z.array(DashboardQuestionSchema).optional(),
}).strict();
export type QuickTestDraft = z.infer<typeof QuickTestDraftSchema>;

export const AssignmentRecipientSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("class"),
    id: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(["pending", "attempted"]),
  }).strict(),
  z.object({
    kind: z.literal("email"),
    email: z.string().email(),
    status: z.enum(["pending", "attempted"]),
  }).strict(),
]);
export type AssignmentRecipient = z.infer<typeof AssignmentRecipientSchema>;

export const DashboardAssignmentSchema = z.object({
  id: z.string().min(1),
  testId: z.string().min(1),
  title: z.string().min(1),
  recipients: z.array(AssignmentRecipientSchema).min(1),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type DashboardAssignment = z.infer<typeof DashboardAssignmentSchema>;

export const AttemptResponseSchema = z.object({
  questionId: z.string().min(1),
  selectedChoiceId: z.string().min(1),
}).strict();
export type AttemptResponse = z.infer<typeof AttemptResponseSchema>;

export const StudentAttemptSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  studentId: z.string().min(1),
  status: z.enum(["in-progress", "submitted"]),
  startedAt: z.string().datetime({ offset: true }),
  submittedAt: z.string().datetime({ offset: true }).nullable(),
  responses: z.array(AttemptResponseSchema),
  questions: z.array(DashboardQuestionSchema).optional(),
}).strict();
export type StudentAttempt = z.infer<typeof StudentAttemptSchema>;

export const AttemptResultSchema = z.object({
  attemptId: z.string().min(1),
  assignmentId: z.string().min(1),
  score: z.number().finite().nonnegative(),
  totalMarks: z.number().finite().positive(),
  released: z.boolean(),
  questionResults: z.array(z.object({
    questionId: z.string().min(1),
    selectedChoiceId: z.string().min(1),
    marksAwarded: z.number().finite(),
  }).strict()),
}).strict();
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

export const TeacherInsightsSchema = z.object({
  aggregate: z.object({
    attempted: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    averageScore: z.number().finite().nonnegative(),
  }).strict(),
  individual: z.array(z.object({
    studentId: z.string().min(1),
    displayName: z.string().min(1),
    score: z.number().finite().nonnegative().nullable(),
    status: z.enum(["attempted", "pending"]),
  }).strict()),
}).strict();
export type TeacherInsights = z.infer<typeof TeacherInsightsSchema>;

export const StudentInsightsSchema = z.object({
  personal: z.object({
    attempted: z.number().int().nonnegative(),
    averageScore: z.number().finite().nonnegative(),
    score: z.number().finite().nonnegative(),
    latestScore: z.number().finite().nonnegative().nullable(),
  }).strict(),
}).strict();
export type StudentInsights = z.infer<typeof StudentInsightsSchema>;

export const TeacherDashboardSnapshotSchema = z.object({
  role: z.literal("teacher"),
  session: TeacherDashboardSessionSchema,
  organisation: DashboardOrganisationSchema,
  classes: z.array(DashboardClassSchema),
  invites: z.array(DashboardInviteSchema),
  quickTests: z.array(QuickTestDraftSchema),
  assignments: z.array(DashboardAssignmentSchema),
  insights: TeacherInsightsSchema,
}).strict();
export type TeacherDashboardSnapshot = z.infer<typeof TeacherDashboardSnapshotSchema>;

export const StudentDashboardSnapshotSchema = z.object({
  role: z.literal("student"),
  session: StudentDashboardSessionSchema,
  organisation: DashboardOrganisationSchema,
  classes: z.array(DashboardClassSchema),
  assignments: z.array(DashboardAssignmentSchema),
  attempts: z.array(StudentAttemptSchema),
  results: z.array(AttemptResultSchema),
  insights: StudentInsightsSchema,
}).strict();
export type StudentDashboardSnapshot = z.infer<typeof StudentDashboardSnapshotSchema>;

export const DashboardSnapshotSchema = z.discriminatedUnion("role", [
  TeacherDashboardSnapshotSchema,
  StudentDashboardSnapshotSchema,
]);
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

const ActionBase = { type: z.string() };
export const CreateQuickTestActionSchema = z.object({
  ...ActionBase,
  type: z.literal("create-quick-test"),
  topic: z.string().trim().min(1),
  questionCount: z.number().int().positive().max(100),
  difficulty: QuickTestDifficultySchema,
  durationMinutes: z.number().int().positive().max(240),
  negativeMarking: z.boolean(),
  releasePolicy: ReleasePolicySchema,
}).strict();
export type CreateQuickTestAction = z.infer<typeof CreateQuickTestActionSchema>;

export const CreateAssignmentActionSchema = z.object({
  ...ActionBase,
  type: z.literal("create-assignment"),
  testId: z.string().min(1),
  title: z.string().trim().min(1),
  classIds: z.array(z.string().min(1)).default([]),
  directEmails: z.array(z.string().email()).default([]),
}).strict().refine((input) => input.classIds.length > 0 || input.directEmails.length > 0, {
  message: "At least one class or direct email recipient is required",
  path: ["classIds"],
});
export type CreateAssignmentAction = z.infer<typeof CreateAssignmentActionSchema>;

export const InviteStudentActionSchema = z.object({
  ...ActionBase,
  type: z.literal("invite-student"),
  email: z.string().email(),
  classId: z.string().min(1),
}).strict();
export type InviteStudentAction = z.infer<typeof InviteStudentActionSchema>;

export const StartAttemptActionSchema = z.object({
  ...ActionBase,
  type: z.literal("start-attempt"),
  assignmentId: z.string().min(1),
}).strict();
export type StartAttemptAction = z.infer<typeof StartAttemptActionSchema>;

export const SubmitAttemptActionSchema = z.object({
  ...ActionBase,
  type: z.literal("submit-attempt"),
  attemptId: z.string().min(1),
  responses: z.array(AttemptResponseSchema),
}).strict();
export type SubmitAttemptAction = z.infer<typeof SubmitAttemptActionSchema>;

export const DashboardActionSchema = z.discriminatedUnion("type", [
  CreateQuickTestActionSchema,
  CreateAssignmentActionSchema,
  InviteStudentActionSchema,
  StartAttemptActionSchema,
  SubmitAttemptActionSchema,
]);
export type DashboardAction = z.infer<typeof DashboardActionSchema>;

export function parseDashboardAction(input: unknown): DashboardAction {
  return DashboardActionSchema.parse(input);
}

export function parseDashboardSnapshot(input: unknown): DashboardSnapshot {
  return DashboardSnapshotSchema.parse(input);
}

export const DashboardProblemSchema = z.object({
  code: z.literal("invalid_request"),
  message: z.string().min(1),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }).strict()).optional(),
}).strict();
export type DashboardProblem = z.infer<typeof DashboardProblemSchema>;
