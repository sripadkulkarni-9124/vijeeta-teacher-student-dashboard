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
    const assignment = (id: string, title: string, available = true) => ({
      id,
      testId: "test-1",
      title,
      available,
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
        assignment("assignment-later", "Units revision", false),
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

  it("keeps submitted attempts submitted while a scheduled result is withheld", () => {
    const input: ApiStudentSnapshot = {
      ...base,
      role: "student",
      session: { role: "student", userId: "student-1", displayName: "Aarav Kulkarni", organisationId: "org-1" },
      assignments: [{
        id: "assignment-scheduled",
        testId: "test-1",
        title: "Scheduled result",
        available: true,
        recipients: [{ kind: "class", id: "class-1", label: "Class 11 Physics", status: "attempted" }],
        createdAt: "2026-08-27T00:00:00.000Z",
      }],
      attempts: [{
        id: "attempt-scheduled",
        assignmentId: "assignment-scheduled",
        studentId: "student-1",
        status: "submitted",
        startedAt: "2026-08-27T00:00:00.000Z",
        submittedAt: "2026-08-27T00:10:00.000Z",
        responses: [],
      }],
      results: [],
      insights: { personal: { attempted: 1, averageScore: 0, score: 0, latestScore: null } },
    };

    const view = toStudentView(input);
    expect(view.tests[0]).toEqual(expect.objectContaining({ status: "submitted", score: undefined }));
    expect(view.insights.testsCompleted).toBe(1);
  });

  it("maps in-progress attempt questions and choices into the selected student test", () => {
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
        {
          id: "assignment-1",
          testId: "test-1",
          title: "Motion checkpoint",
          recipients: [
            {
              kind: "class",
              id: "class-1",
              label: "Class 11 Physics",
              status: "pending",
            },
          ],
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          assignmentId: "assignment-1",
          studentId: "student-1",
          status: "in-progress",
          startedAt: "2026-08-27T00:00:00.000Z",
          submittedAt: null,
          responses: [],
          questions: [
            {
              id: "question-1",
              prompt: "What does the slope of a distance-time graph represent?",
              marks: 1,
              choices: [
                { id: "choice-speed", label: "Speed" },
                { id: "choice-force", label: "Force" },
              ],
            },
          ],
        },
      ],
      results: [],
      insights: {
        personal: { attempted: 0, averageScore: 0, score: 0, latestScore: 0 },
      },
    };

    const view = toStudentView(input);

    expect(view.tests[0]).toEqual(
      expect.objectContaining({
        status: "in-progress",
        questions: [
          {
            id: "question-1",
            prompt: "What does the slope of a distance-time graph represent?",
            choices: [
              { id: "choice-speed", label: "Speed" },
              { id: "choice-force", label: "Force" },
            ],
          },
        ],
      }),
    );
    expect(view.selectedTestId).toBe("assignment-1");
  });
});
