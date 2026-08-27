import type {
  DemoAdminOrganisation,
  DemoAssignment,
  DemoAttempt,
  DemoBatch,
  DemoOrganisation,
  DemoQuestionBank,
  DemoReleasedResult,
  DemoStudent,
  DemoTeacherDashboard,
  DemoTest,
} from "./types";
import { STUDENT_DELIVERY_FIXTURE } from "./student-delivery";

const DEMO_QUESTIONS = STUDENT_DELIVERY_FIXTURE.test.questions.map(
  (question) => ({ ...question, marks: 4 }),
);

export const DEMO_ORGANISATION: DemoOrganisation =
  STUDENT_DELIVERY_FIXTURE.organisation;

export const DEMO_TEACHER_DASHBOARD: DemoTeacherDashboard = {
  organisationId: DEMO_ORGANISATION.id,
  teacher: {
    id: "teacher-meera-shah",
    name: "Meera Shah",
    subject: "Physics",
  },
  activeAssignments: 1,
  scheduledTests: 1,
  reviewQueueCount: 2,
};

export const DEMO_QUESTION_BANK: DemoQuestionBank = {
  id: "question-bank-motion-foundations",
  organisationId: DEMO_ORGANISATION.id,
  name: "Motion foundations",
  questions: DEMO_QUESTIONS,
};

export const DEMO_STUDENT: DemoStudent = STUDENT_DELIVERY_FIXTURE.student;

export const DEMO_BATCH: DemoBatch = STUDENT_DELIVERY_FIXTURE.batch;

export const DEMO_DRAFT: DemoTest = {
  id: "test-draft-motion-check",
  organisationId: DEMO_ORGANISATION.id,
  title: "Motion check draft",
  status: "draft",
  durationMinutes: 10,
  questions: DEMO_QUESTIONS,
};

export const DEMO_TEST: DemoTest = {
  ...STUDENT_DELIVERY_FIXTURE.test,
  status: "scheduled",
  durationMinutes: 20,
  questions: DEMO_QUESTIONS,
};

export const DEMO_ASSIGNMENT: DemoAssignment =
  STUDENT_DELIVERY_FIXTURE.assignment;

export const DEMO_ATTEMPT: DemoAttempt = {
  ...STUDENT_DELIVERY_FIXTURE.attempt,
  questions: DEMO_TEST.questions,
  responses: [
    {
      questionId: "question-kinematics-01",
      selectedChoiceId: "choice-a",
      savedAt: "2026-09-01T05:03:00.000Z",
      saveState: "saved",
    },
    {
      questionId: "question-units-01",
      selectedChoiceId: "choice-b",
      savedAt: "2026-09-01T05:04:00.000Z",
      saveState: "saved",
    },
  ],
};

export const DEMO_RESULT: DemoReleasedResult = {
  id: "result-aarav-physics-01",
  attemptId: DEMO_ATTEMPT.id,
  assignmentId: DEMO_ASSIGNMENT.id,
  releasedAt: "2026-09-01T08:31:00.000Z",
  score: 8,
  totalMarks: 8,
  questionResults: [
    {
      questionId: "question-kinematics-01",
      selectedChoiceId: "choice-a",
      correctAnswerId: "choice-a",
      explanation: "For constant acceleration from rest, velocity is proportional to elapsed time.",
      marksAwarded: 4,
    },
    {
      questionId: "question-units-01",
      selectedChoiceId: "choice-b",
      correctAnswerId: "choice-b",
      explanation: "The newton is the SI unit for force.",
      marksAwarded: 4,
    },
  ],
};

export const DEMO_ADMIN_ORGANISATION: DemoAdminOrganisation = {
  organisationId: DEMO_ORGANISATION.id,
  administratorName: "Rohan Iyer",
  teacherCount: 6,
  batchCount: 4,
  activeLearnerCount: DEMO_ORGANISATION.learnerCount,
};
