export type SurfaceScenario =
  | "ready"
  | "loading"
  | "first-use"
  | "empty"
  | "error"
  | "offline"
  | "permission-denied"
  | "suspended";

export type SaveState = "saving" | "saved" | "offline" | "retrying" | "conflict";

export type TestStatus = "draft" | "in-review" | "scheduled" | "live" | "closed";

export type ReleasePolicy =
  | { kind: "learning-mode" }
  | { kind: "after-test" }
  | { kind: "scheduled"; releaseAt: string };

export interface DemoChoice {
  id: string;
  label: string;
}

export interface DemoAttemptQuestion {
  id: string;
  prompt: string;
  choices: readonly DemoChoice[];
  marks: number;
}

export interface DemoOrganisation {
  id: string;
  name: string;
  city: string;
  learnerCount: number;
}

export interface DemoTeacher {
  id: string;
  name: string;
  subject: string;
}

export interface DemoTeacherDashboard {
  organisationId: string;
  teacher: DemoTeacher;
  activeAssignments: number;
  scheduledTests: number;
  reviewQueueCount: number;
}

export interface DemoQuestionBank {
  id: string;
  organisationId: string;
  name: string;
  questions: readonly DemoAttemptQuestion[];
}

export interface DemoStudent {
  id: string;
  organisationId: string;
  name: string;
  grade: string;
}

export interface DemoBatch {
  id: string;
  organisationId: string;
  name: string;
  studentIds: readonly string[];
}

export interface DemoTest {
  id: string;
  organisationId: string;
  title: string;
  status: TestStatus;
  durationMinutes: number;
  questions: readonly DemoAttemptQuestion[];
}

export interface DemoAssignment {
  id: string;
  organisationId: string;
  testId: string;
  batchId: string;
  title: string;
  opensAt: string;
  closesAt: string;
  releasePolicy: ReleasePolicy;
}

export interface DemoAttemptResponse {
  questionId: string;
  selectedChoiceId: string;
  savedAt: string;
  saveState: SaveState;
}

export interface DemoAttempt {
  id: string;
  assignmentId: string;
  organisationId: string;
  studentId: string;
  status: "in-progress" | "submitted";
  startedAt: string;
  questions: readonly DemoAttemptQuestion[];
  responses: readonly DemoAttemptResponse[];
}

export interface DemoReleasedQuestionResult {
  questionId: string;
  selectedChoiceId: string;
  correctAnswerId: string;
  explanation: string;
  marksAwarded: number;
}

export interface DemoReleasedResult {
  id: string;
  attemptId: string;
  assignmentId: string;
  releasedAt: string;
  score: number;
  totalMarks: number;
  questionResults: readonly DemoReleasedQuestionResult[];
}

export interface DemoAdminOrganisation {
  organisationId: string;
  administratorName: string;
  teacherCount: number;
  batchCount: number;
  activeLearnerCount: number;
}
