import type {
  StudentDashboardSnapshot as ApiStudentSnapshot,
  TeacherDashboardSnapshot as ApiTeacherSnapshot,
} from "@vijeeta/api-contracts";
import { describe, expect, it } from "vitest";

import { toStudentView, toTeacherView } from "./view-models";

const base = {
  organisation: { id: "org-1", name: "Aurora Academy" },
  classes: [
    {
      id: "class-1",
      name: "Class 11 Physics",
      subject: "Physics",
      roster: [
        {
          id: "student-1",
          displayName: "Aarav Kulkarni",
          email: "aarav@example.test",
          status: "active" as const,
        },
      ],
    },
  ],
};

describe("dashboard API view models", () => {
  it("maps teacher aggregate and individual state without losing roster status", () => {
    const input: ApiTeacherSnapshot = {
      ...base,
      role: "teacher",
      session: {
        role: "teacher",
        userId: "teacher-1",
        displayName: "Meera Shah",
        organisationId: "org-1",
      },
      invites: [],
      quickTests: [
        {
          id: "draft-1",
          topic: "Kinematics",
          questionCount: 12,
          difficulty: "hard",
          durationMinutes: 20,
          negativeMarking: false,
          releasePolicy: "after-test",
          status: "draft",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      assignments: [],
      insights: {
        aggregate: { attempted: 1, pending: 0, averageScore: 8 },
        individual: [
          {
            studentId: "student-1",
            displayName: "Aarav Kulkarni",
            score: 8,
            status: "attempted",
          },
        ],
      },
    };

    const view = toTeacherView(input);
    expect(view.teacher).toEqual({ name: "Meera Shah", organisation: "Aurora Academy" });
    expect(view.roster[0]).toEqual(expect.objectContaining({ status: "attempted", score: "8 marks" }));
    expect(view.tests[0]).toEqual(expect.objectContaining({ topic: "Kinematics", difficulty: "Hard" }));
  });

  it("maps assignments into assigned, pending, and submitted student groups", () => {
    const assignment = (id: string, title: string) => ({
      id,
      testId: "test-1",
      title,
      recipients: [
        { kind: "class" as const, id: "class-1", label: "Class 11 Physics", status: "pending" as const },
      ],
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const input: ApiStudentSnapshot = {
      ...base,
      role: "student",
      session: {
        role: "student",
        userId: "student-1",
        displayName: "Aarav Kulkarni",
        organisationId: "org-1",
      },
      assignments: [
        assignment("assignment-done", "Kinematics checkpoint"),
        assignment("assignment-next", "Motion foundations"),
        assignment("assignment-later", "Units revision"),
      ],
      attempts: [
        {
          id: "attempt-1",
          assignmentId: "assignment-done",
          studentId: "student-1",
          status: "submitted",
          startedAt: "2026-08-27T00:00:00.000Z",
          submittedAt: "2026-08-27T00:10:00.000Z",
          responses: [],
        },
      ],
      results: [
        {
          attemptId: "attempt-1",
          assignmentId: "assignment-done",
          score: 8,
          totalMarks: 10,
          released: true,
          questionResults: [],
        },
      ],
      insights: { personal: { attempted: 1, averageScore: 8, score: 8, latestScore: 8 } },
    };

    const view = toStudentView(input);
    expect(view.tests.map((test) => test.status)).toEqual(["submitted", "assigned", "pending"]);
    expect(view.selectedTestId).toBe("assignment-next");
    expect(view.insights.averageScore).toBe("80%");
  });
});
