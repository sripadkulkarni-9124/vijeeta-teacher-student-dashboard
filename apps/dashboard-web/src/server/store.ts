import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AttemptResultSchema,
  DashboardAssignmentSchema,
  DashboardClassSchema,
  DashboardInviteSchema,
  DashboardOrganisationSchema,
  DashboardQuestionSchema,
  QuickTestDraftSchema,
  ReleasePolicySchema,
  StudentAttemptSchema,
  StudentDashboardSessionSchema,
  TeacherDashboardSessionSchema,
  type AttemptResponse,
  type AssignmentRecipient,
  type DashboardAction,
  type DashboardAssignment,
  type DashboardClass,
  type DashboardDispatchResult,
  type DashboardQuestion,
  type DashboardSnapshot,
  type DashboardInvite,
  type QuickTestDraft,
  type ReleasePolicy,
  type StudentAttempt,
  type AttemptResult,
  type TeacherDashboardSnapshot,
  type StudentDashboardSnapshot,
} from "@vijeeta/api-contracts";
import { DEMO_RESULT, DEMO_TEST } from "@vijeeta/product-fixtures";

export interface MessagingAdapter {
  sendInvite(input: { email: string; classId: string }): Promise<void>;
}

export interface TestEngineAdapter {
  generateQuestions(input: {
    topic: string;
    questionCount: number;
    difficulty: string;
  }): Promise<DashboardQuestion[]>;
}

export class CaptureMessagingAdapter implements MessagingAdapter {
  readonly invites: Array<{ email: string; classId: string }> = [];

  async sendInvite(input: { email: string; classId: string }): Promise<void> {
    this.invites.push({ ...input });
  }
}

export class CaptureTestEngineAdapter implements TestEngineAdapter {
  readonly requests: Array<{ topic: string; questionCount: number; difficulty: string }> = [];
  readonly answerKeys: Record<string, string> = {};

  async generateQuestions(input: { topic: string; questionCount: number; difficulty: string }): Promise<DashboardQuestion[]> {
    this.requests.push({ ...input });
    const topicSlug = slug(input.topic);
    return Array.from({ length: input.questionCount }, (_, index) => {
      const sequence = index + 1;
      const questionId = `question-${topicSlug}-${sequence}`;
      const choices = ["a", "b", "c", "d"].map((suffix) => ({
        id: `choice-${topicSlug}-${sequence}-${suffix}`,
        label: `Option ${suffix.toUpperCase()}`,
      }));
      this.answerKeys[questionId] = choices[index % choices.length].id;
      return {
        id: questionId,
        prompt: `${input.topic}: ${input.difficulty} practice question ${sequence}`,
        choices,
        marks: 4,
      };
    });
  }
}

interface InternalTest {
  id: string;
  title: string;
  questions: DashboardQuestion[];
  answerKeys: Record<string, string>;
  releasePolicy: ReleasePolicy;
}

export interface DashboardState {
  version: 1;
  organisation: { id: string; name: string };
  sessions: {
    teacher: { role: "teacher"; userId: string; displayName: string; organisationId: string };
    student: { role: "student"; userId: string; displayName: string; organisationId: string };
  };
  classes: DashboardClass[];
  invites: DashboardInvite[];
  quickTests: QuickTestDraft[];
  tests: InternalTest[];
  assignments: DashboardAssignment[];
  attempts: StudentAttempt[];
  results: AttemptResult[];
}

export interface DashboardStoreOptions {
  filePath?: string;
  now?: () => string;
  messaging?: MessagingAdapter;
  testEngine?: TestEngineAdapter;
}

const DEFAULT_STATE_PATH = resolve(process.cwd(), ".local/dashboard-state.json");
const ORGANISATION = { id: "org-aurora-academy", name: "Aurora Academy" };
const STUDENT_ID = "student-aarav-kulkarni";
const TEACHER_ID = "teacher-meera-shah";

function demoQuestions(): DashboardQuestion[] {
  return DEMO_TEST.questions.map((question) => ({ ...question, choices: question.choices.map((choice) => ({ ...choice })), marks: 4 }));
}

function initialState(): DashboardState {
  const questions = demoQuestions();
  const assignment: DashboardAssignment = {
    id: "assignment-physics-foundations-01",
    testId: DEMO_TEST.id,
    title: DEMO_TEST.title,
    recipients: [{ kind: "class", id: "class-aurora-physics", label: "Class 11 Physics", status: "pending" }],
    createdAt: "2026-09-01T04:00:00.000Z",
  };
  const upcomingAssignments: DashboardAssignment[] = [
    {
      id: "assignment-motion-foundations-02",
      testId: DEMO_TEST.id,
      title: "Motion foundations",
      recipients: [{ kind: "class", id: "class-aurora-physics", label: "Class 11 Physics", status: "pending" }],
      createdAt: "2026-09-02T04:00:00.000Z",
    },
    {
      id: "assignment-units-revision-03",
      testId: DEMO_TEST.id,
      title: "Units revision",
      recipients: [{ kind: "class", id: "class-aurora-physics", label: "Class 11 Physics", status: "pending" }],
      createdAt: "2026-09-03T04:00:00.000Z",
    },
  ];
  return {
    version: 1,
    organisation: ORGANISATION,
    sessions: {
      teacher: { role: "teacher", userId: TEACHER_ID, displayName: "Meera Shah", organisationId: ORGANISATION.id },
      student: { role: "student", userId: STUDENT_ID, displayName: "Aarav Kulkarni", organisationId: ORGANISATION.id },
    },
    classes: [{
      id: "class-aurora-physics",
      name: "Class 11 Physics",
      subject: "Physics",
      roster: [{ id: STUDENT_ID, displayName: "Aarav Kulkarni", email: "aarav@example.com", status: "active" }],
    }],
    invites: [],
    quickTests: [{
      id: "draft-motion-check",
      topic: "Motion",
      questionCount: questions.length,
      difficulty: "mixed",
      durationMinutes: 10,
      negativeMarking: false,
      releasePolicy: "after-test",
      status: "draft",
      createdAt: "2026-09-01T04:00:00.000Z",
      questions,
    }],
    tests: [{
      id: DEMO_TEST.id,
      title: DEMO_TEST.title,
      questions,
      answerKeys: { "question-kinematics-01": "choice-a", "question-units-01": "choice-b" },
      releasePolicy: "after-test",
    }],
    assignments: [assignment, ...upcomingAssignments],
    attempts: [{
      id: "attempt-aarav-physics-01",
      assignmentId: assignment.id,
      studentId: STUDENT_ID,
      status: "submitted",
      startedAt: "2026-09-01T05:00:00.000Z",
      submittedAt: "2026-09-01T08:30:00.000Z",
      responses: DEMO_RESULT.questionResults.map((response) => ({ questionId: response.questionId, selectedChoiceId: response.selectedChoiceId })),
      questions,
    }],
    results: [{
      attemptId: "attempt-aarav-physics-01",
      assignmentId: assignment.id,
      score: DEMO_RESULT.score,
      totalMarks: DEMO_RESULT.totalMarks,
      released: true,
      questionResults: DEMO_RESULT.questionResults.map((response) => ({
        questionId: response.questionId,
        selectedChoiceId: response.selectedChoiceId,
        marksAwarded: response.marksAwarded,
      })),
    }],
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function toRecipientStatus(recipient: AssignmentRecipient, state: DashboardState, assignmentId: string): AssignmentRecipient {
  if (recipient.kind === "email") return { ...recipient };
  const attempted = state.attempts.some((attempt) => attempt.assignmentId === assignmentId && attempt.status === "submitted");
  return { ...recipient, status: attempted ? "attempted" : "pending" };
}

export class DashboardStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private readonly messaging: MessagingAdapter;
  private readonly testEngine: TestEngineAdapter;

  constructor(options: DashboardStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_STATE_PATH;
    this.now = options.now ?? (() => new Date().toISOString());
    this.messaging = options.messaging ?? new CaptureMessagingAdapter();
    this.testEngine = options.testEngine ?? new CaptureTestEngineAdapter();
  }

  async snapshot(role: "teacher"): Promise<TeacherDashboardSnapshot>;
  async snapshot(role: "student"): Promise<StudentDashboardSnapshot>;
  async snapshot(role: "teacher" | "student"): Promise<DashboardSnapshot>;
  async snapshot(role: "teacher" | "student"): Promise<DashboardSnapshot> {
    const state = await this.load();
    const assignments = state.assignments.map((assignment) => ({
      ...assignment,
      recipients: assignment.recipients.map((recipient) => toRecipientStatus(recipient, state, assignment.id)),
    }));
    if (role === "teacher") {
      const eligibleStudentIds = new Set(state.classes.flatMap((entry) => entry.roster.map((student) => student.id)));
      const submittedStudentIds = new Set(state.attempts
        .filter((attempt) => attempt.status === "submitted" && eligibleStudentIds.has(attempt.studentId))
        .map((attempt) => attempt.studentId));
      const attempted = submittedStudentIds.size;
      const pending = Math.max(0, eligibleStudentIds.size - attempted);
      return {
        role,
        session: state.sessions.teacher,
        organisation: state.organisation,
        classes: state.classes,
        invites: state.invites,
        quickTests: state.quickTests,
        assignments,
        insights: {
          aggregate: { attempted, pending, averageScore: averageScore(state.results) },
          individual: state.classes.flatMap((entry) => entry.roster.map((student) => {
            const result = latestStudentResult(state, student.id);
            return { studentId: student.id, displayName: student.displayName, score: result?.score ?? null, status: result ? "attempted" as const : "pending" as const };
          })),
        },
      };
    }
    const studentAttempts = state.attempts.filter((attempt) => attempt.studentId === STUDENT_ID);
    const studentResults = state.results
      .filter((result) => studentAttempts.some((attempt) => attempt.id === result.attemptId))
      .filter((result) => isResultReleased(state, result, this.now()))
      .map((result) => ({ ...result, released: true }));
    return {
      role,
      session: state.sessions.student,
      organisation: state.organisation,
      classes: state.classes,
      assignments,
      attempts: studentAttempts,
      results: studentResults,
      insights: {
        personal: {
          attempted: studentResults.length,
          averageScore: averageScore(studentResults),
          score: studentResults.at(-1)?.score ?? 0,
          latestScore: studentResults.at(-1)?.score ?? null,
        },
      },
    };
  }

  async dispatch(action: DashboardAction): Promise<DashboardDispatchResult> {
    const state = await this.load();
    switch (action.type) {
      case "create-quick-test": {
        const id = `draft-${slug(action.topic)}-${state.quickTests.filter((draft) => draft.topic.toLowerCase() === action.topic.toLowerCase()).length + 1}`;
        const questions = await this.testEngine.generateQuestions({ topic: action.topic, questionCount: action.questionCount, difficulty: action.difficulty });
        const draft: QuickTestDraft = {
          id,
          topic: action.topic,
          questionCount: action.questionCount,
          difficulty: action.difficulty,
          durationMinutes: action.durationMinutes,
          negativeMarking: action.negativeMarking,
          releasePolicy: action.releasePolicy,
          status: "draft",
          createdAt: this.now(),
          questions: questions.length ? questions : undefined,
        };
        state.quickTests.push(draft);
        const answerKeys = Object.fromEntries(questions.map((question) => [
          question.id,
          this.testEngine instanceof CaptureTestEngineAdapter
            ? this.testEngine.answerKeys[question.id]
            : question.choices[0]?.id,
        ]).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        state.tests.push({ id, title: `${action.topic} quick test`, questions, answerKeys, releasePolicy: action.releasePolicy });
        await this.save(state);
        return { type: "quick-test-created", draft };
      }
      case "create-assignment": {
        const test = state.tests.find((entry) => entry.id === action.testId);
        if (!test) {
          throw new DashboardStoreError("Test not found", "not_found");
        }
        const unknownClassId = action.classIds.find((id) => !state.classes.some((entry) => entry.id === id));
        if (unknownClassId) throw new DashboardStoreError("Class not found", "not_found");
        if (test.questions.length === 0) throw new DashboardStoreError("Test has no questions", "conflict");
        const recipients: AssignmentRecipient[] = [
          ...action.classIds.map((id) => ({ kind: "class" as const, id, label: state.classes.find((entry) => entry.id === id)?.name ?? id, status: "pending" as const })),
          ...action.directEmails.map((email) => ({ kind: "email" as const, email, status: "pending" as const })),
        ];
        const assignment: DashboardAssignment = { id: `assignment-${slug(action.title)}-${state.assignments.length + 1}`, testId: action.testId, title: action.title, recipients, createdAt: this.now() };
        state.assignments.push(assignment);
        await this.save(state);
        return { type: "assignment-created", assignment };
      }
      case "invite-student": {
        if (!state.classes.some((entry) => entry.id === action.classId)) throw new DashboardStoreError("Class not found", "not_found");
        const invite: DashboardInvite = { id: `invite-${state.invites.length + 1}`, email: action.email, classId: action.classId, status: "pending", createdAt: this.now() };
        state.invites.push(invite);
        await this.save(state);
        await this.messaging.sendInvite({ email: action.email, classId: action.classId });
        return { type: "student-invited", invite };
      }
      case "start-attempt": {
        const assignment = state.assignments.find((entry) => entry.id === action.assignmentId);
        if (!assignment) throw new DashboardStoreError("Assignment not found", "not_found");
        const test = state.tests.find((entry) => entry.id === assignment.testId);
        if (!test) throw new DashboardStoreError("Test not found", "not_found");
        if (test.questions.length === 0) throw new DashboardStoreError("Test has no questions", "conflict");
        const existingAttempt = state.attempts.find((entry) => entry.assignmentId === assignment.id && entry.studentId === STUDENT_ID);
        if (existingAttempt) throw new DashboardStoreError("Assignment already attempted", "conflict");
        const attempt: StudentAttempt = { id: `attempt-${STUDENT_ID}-${state.attempts.length + 1}`, assignmentId: assignment.id, studentId: STUDENT_ID, status: "in-progress", startedAt: this.now(), submittedAt: null, responses: [], questions: test.questions };
        state.attempts.push(attempt);
        await this.save(state);
        return { type: "attempt-started", attempt };
      }
      case "submit-attempt": {
        const attempt = state.attempts.find((entry) => entry.id === action.attemptId);
        if (!attempt) throw new DashboardStoreError("Attempt not found", "not_found");
        if (attempt.status === "submitted") throw new DashboardStoreError("Attempt already submitted", "conflict");
        const assignment = state.assignments.find((entry) => entry.id === attempt.assignmentId);
        const test = state.tests.find((entry) => entry.id === assignment?.testId);
        if (!assignment || !test) throw new DashboardStoreError("Test not found", "not_found");
        const responses: AttemptResponse[] = action.responses;
        const attemptQuestions = attempt.questions ?? test.questions;
        const uniqueQuestionIds = new Set(responses.map((response) => response.questionId));
        if (uniqueQuestionIds.size !== responses.length) throw new DashboardStoreError("Duplicate question response", "conflict");
        if (uniqueQuestionIds.size !== attemptQuestions.length) {
          throw new DashboardStoreError("Every question requires one response", "conflict");
        }
        for (const response of responses) {
          const question = attemptQuestions.find((entry) => entry.id === response.questionId);
          if (!question) throw new DashboardStoreError("Question not found in attempt", "conflict");
          if (!question.choices.some((choice) => choice.id === response.selectedChoiceId)) {
            throw new DashboardStoreError("Choice not found in question", "conflict");
          }
        }
        attempt.responses = responses;
        attempt.status = "submitted";
        attempt.submittedAt = this.now();
        const questionResults = responses.map((response) => {
          const question = attemptQuestions.find((entry) => entry.id === response.questionId);
          const marksAwarded = question && test.answerKeys[response.questionId] === response.selectedChoiceId ? question.marks : 0;
          return { questionId: response.questionId, selectedChoiceId: response.selectedChoiceId, marksAwarded };
        });
        const totalMarks = attemptQuestions.reduce((sum, question) => sum + question.marks, 0) || 1;
        const result: AttemptResult = { attemptId: attempt.id, assignmentId: assignment.id, score: questionResults.reduce((sum, question) => sum + question.marksAwarded, 0), totalMarks, released: isReleasePolicyReleased(test.releasePolicy, this.now()), questionResults };
        state.results.push(result);
        await this.save(state);
        return { type: "attempt-submitted", attempt, result };
      }
    }
  }

  getSnapshot(role: "teacher"): Promise<TeacherDashboardSnapshot>;
  getSnapshot(role: "student"): Promise<StudentDashboardSnapshot>;
  getSnapshot(role: "teacher" | "student"): Promise<DashboardSnapshot>;
  getSnapshot(role: "teacher" | "student"): Promise<DashboardSnapshot> {
    return this.snapshot(role);
  }

  private async load(): Promise<DashboardState> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const state = initialState();
      await this.save(state);
      return state;
    }
    try {
      const state = parseDashboardState(JSON.parse(content));
      const upgraded = upgradeState(state);
      if (upgraded) await this.save(state);
      return state;
    } catch (error) {
      throw new Error(
        `The local dashboard state is corrupt or incompatible. Remove the local state file to reset the demo: ${this.filePath}`,
        { cause: error },
      );
    }
  }

  private async save(state: DashboardState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

function parseDashboardState(input: unknown): DashboardState {
  const state = asRecord(input, "dashboard state");
  if (state.version !== 1) throw new Error("Unsupported dashboard state version");
  const sessions = asRecord(state.sessions, "sessions");
  return {
    version: 1,
    organisation: DashboardOrganisationSchema.parse(state.organisation),
    sessions: {
      teacher: TeacherDashboardSessionSchema.parse(sessions.teacher),
      student: StudentDashboardSessionSchema.parse(sessions.student),
    },
    classes: parseArray(state.classes, (value) => DashboardClassSchema.parse(value)),
    invites: parseArray(state.invites, (value) => DashboardInviteSchema.parse(value)),
    quickTests: parseArray(state.quickTests, parseQuickTestDraft),
    tests: parseArray(state.tests, parseInternalTest),
    assignments: parseArray(state.assignments, (value) => DashboardAssignmentSchema.parse(value)),
    attempts: parseArray(state.attempts, (value) => StudentAttemptSchema.parse(value)),
    results: parseArray(state.results, (value) => AttemptResultSchema.parse(value)),
  };
}

function parseQuickTestDraft(input: unknown): QuickTestDraft {
  const draft = asRecord(input, "quick test draft");
  const persistedDraft = { ...draft };
  delete persistedDraft.type;
  return QuickTestDraftSchema.parse(persistedDraft);
}

function parseInternalTest(input: unknown): InternalTest {
  const test = asRecord(input, "test");
  const answerKeys = asRecord(test.answerKeys, "answer keys");
  if (typeof test.id !== "string" || !test.id || typeof test.title !== "string" || !test.title) {
    throw new Error("Invalid local test identity");
  }
  if (!Object.values(answerKeys).every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Invalid local test answer keys");
  }
  return {
    id: test.id,
    title: test.title,
    questions: parseArray(test.questions, (value) => DashboardQuestionSchema.parse(value)),
    answerKeys: answerKeys as Record<string, string>,
    releasePolicy: test.releasePolicy === undefined
      ? "after-test"
      : ReleasePolicySchema.parse(test.releasePolicy),
  };
}

function parseArray<T>(input: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(input)) throw new Error("Expected an array in local dashboard state");
  return input.map(parse);
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Invalid ${label}`);
  }
  return input as Record<string, unknown>;
}

function upgradeState(state: DashboardState): boolean {
  const defaults = initialState();
  let changed = false;
  for (const assignment of defaults.assignments) {
    if (state.assignments.some((entry) => entry.id === assignment.id)) continue;
    state.assignments.push(assignment);
    changed = true;
  }
  for (const test of state.tests) {
    if (test.releasePolicy) continue;
    test.releasePolicy = state.quickTests.find((draft) => draft.id === test.id)?.releasePolicy ?? "after-test";
    changed = true;
  }
  return changed;
}

function isReleasePolicyReleased(policy: ReleasePolicy, now: string): boolean {
  if (typeof policy === "string") return true;
  return Date.parse(policy.releaseAt) <= Date.parse(now);
}

function isResultReleased(state: DashboardState, result: AttemptResult, now: string): boolean {
  if (result.released) return true;
  const assignment = state.assignments.find((entry) => entry.id === result.assignmentId);
  const test = state.tests.find((entry) => entry.id === assignment?.testId);
  return test ? isReleasePolicyReleased(test.releasePolicy, now) : false;
}

function averageScore(results: AttemptResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, result) => sum + result.score, 0) / results.length;
}

function latestStudentResult(state: DashboardState, studentId: string): AttemptResult | undefined {
  const attempts = state.attempts.filter((attempt) => attempt.studentId === studentId).map((attempt) => attempt.id);
  return [...state.results].reverse().find((result) => attempts.includes(result.attemptId));
}

export class DashboardStoreError extends Error {
  constructor(message: string, readonly code: "not_found" | "conflict") {
    super(message);
    this.name = "DashboardStoreError";
  }
}
