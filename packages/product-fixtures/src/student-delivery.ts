/**
 * The delivery-safe half of the shared Aurora fixture journey.
 *
 * This module deliberately owns no released result, answer key, or
 * explanation. Student clients import this subpath rather than the broad
 * fixture barrel so Metro cannot retain released data in their bundle.
 */
export interface StudentDeliveryChoice {
  id: string;
  label: string;
}

export type ReleasePolicy =
  | { kind: "after-test" }
  | { kind: "learning-mode" }
  | { kind: "scheduled"; releaseAt: string };

export interface StudentDeliveryQuestion {
  id: string;
  prompt: string;
  choices: readonly StudentDeliveryChoice[];
}

export interface StudentDeliveryFixture {
  organisation: {
    id: string;
    name: string;
    city: string;
    learnerCount: number;
  };
  student: {
    id: string;
    organisationId: string;
    name: string;
    grade: string;
  };
  batch: {
    id: string;
    organisationId: string;
    name: string;
    studentIds: readonly string[];
  };
  test: {
    id: string;
    organisationId: string;
    title: string;
    durationMinutes: number;
    questions: readonly StudentDeliveryQuestion[];
  };
  assignment: {
    id: string;
    organisationId: string;
    testId: string;
    batchId: string;
    title: string;
    opensAt: string;
    closesAt: string;
    releasePolicy: ReleasePolicy;
  };
  attempt: {
    id: string;
    assignmentId: string;
    organisationId: string;
    studentId: string;
    status: "submitted";
    startedAt: string;
    responses: readonly {
      questionId: string;
      selectedChoiceId: string;
      savedAt: string;
      saveState: "saved";
    }[];
  };
}

export const STUDENT_DELIVERY_FIXTURE = {
  organisation: {
    id: "org-aurora-academy",
    name: "Aurora Academy",
    city: "Pune",
    learnerCount: 48,
  },
  student: {
    id: "student-aarav-kulkarni",
    organisationId: "org-aurora-academy",
    name: "Aarav Kulkarni",
    grade: "Class 11",
  },
  batch: {
    id: "batch-aurora-11-physics",
    organisationId: "org-aurora-academy",
    name: "Class 11 Physics",
    studentIds: ["student-aarav-kulkarni"],
  },
  test: {
    id: "test-demo-physics-01",
    organisationId: "org-aurora-academy",
    title: "Physics foundations check",
    durationMinutes: 20,
    questions: [
      {
        id: "question-kinematics-01",
        prompt:
          "A cart moves from rest with constant acceleration. Which quantity increases linearly with time?",
        choices: [
          { id: "choice-a", label: "Velocity" },
          { id: "choice-b", label: "Kinetic energy" },
          { id: "choice-c", label: "Distance from the start" },
          { id: "choice-d", label: "Momentum squared" },
        ],
      },
      {
        id: "question-units-01",
        prompt: "Which SI unit is used for force?",
        choices: [
          { id: "choice-a", label: "Joule" },
          { id: "choice-b", label: "Newton" },
          { id: "choice-c", label: "Watt" },
          { id: "choice-d", label: "Pascal" },
        ],
      },
    ],
  },
  assignment: {
    id: "assignment-physics-foundations-01",
    organisationId: "org-aurora-academy",
    testId: "test-demo-physics-01",
    batchId: "batch-aurora-11-physics",
    title: "Physics foundations check",
    opensAt: "2026-09-01T04:30:00.000Z",
    closesAt: "2026-09-01T08:30:00.000Z",
    releasePolicy: { kind: "after-test" },
  },
  attempt: {
    id: "attempt-aarav-physics-01",
    assignmentId: "assignment-physics-foundations-01",
    organisationId: "org-aurora-academy",
    studentId: "student-aarav-kulkarni",
    status: "submitted",
    startedAt: "2026-09-01T05:00:00.000Z",
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
  },
} as const satisfies StudentDeliveryFixture;
