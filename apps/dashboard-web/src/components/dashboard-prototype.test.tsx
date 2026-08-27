import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoApi } from "@/client/demo-api";
import { DashboardPrototype } from "./dashboard-prototype";

afterEach(() => {
  document.body.replaceChildren();
});

describe("DashboardPrototype", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads the role snapshot from the local API and switches back", async () => {
    const api: DemoApi = {
      snapshot: vi.fn(async () => ({
        role: "teacher" as const,
        session: {
          role: "teacher" as const,
          userId: "teacher-1",
          displayName: "Meera Shah",
          organisationId: "org-1",
        },
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
        invites: [],
        quickTests: [],
        assignments: [],
        insights: {
          aggregate: { attempted: 0, pending: 1, averageScore: 0 },
          individual: [
            {
              studentId: "student-1",
              displayName: "Aarav Kulkarni",
              score: null,
              status: "pending" as const,
            },
          ],
        },
      })),
      mutate: vi.fn(async () => {
        throw new Error("This test does not mutate dashboard state");
      }),
    };
    render(<DashboardPrototype api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue as teacher" }));
    expect(
      await screen.findByRole("heading", { name: "Teacher dashboard" }),
    ).toBeVisible();
    expect(api.snapshot).toHaveBeenCalledWith("teacher");
    expect(screen.getByText("Local API connected")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Switch role" }));
    expect(
      screen.getByRole("heading", { name: "Choose your demo workspace" }),
    ).toBeVisible();
  });

  it("submits the student's selected responses to the local API", async () => {
    const studentSnapshot = (attempted: boolean) => ({
      role: "student" as const,
      session: {
        role: "student" as const,
        userId: "student-1",
        displayName: "Aarav Kulkarni",
        organisationId: "org-1",
      },
      organisation: { id: "org-1", name: "Aurora Academy" },
      classes: [
        {
          id: "class-1",
          name: "Class 11 Physics",
          subject: "Physics",
          roster: [],
        },
      ],
      assignments: [
        {
          id: "assignment-1",
          testId: "test-1",
          title: "Motion checkpoint",
          recipients: [
            {
              kind: "class" as const,
              id: "class-1",
              label: "Class 11 Physics",
              status: "pending" as const,
            },
          ],
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      attempts: attempted
        ? [
            {
              id: "attempt-1",
              assignmentId: "assignment-1",
              studentId: "student-1",
              status: "in-progress" as const,
              startedAt: "2026-08-27T00:00:00.000Z",
              submittedAt: null,
              responses: [],
              questions: [
                {
                  id: "question-1",
                  prompt: "What does the slope show?",
                  marks: 1,
                  choices: [
                    { id: "choice-speed", label: "Speed" },
                    { id: "choice-force", label: "Force" },
                  ],
                },
              ],
            },
          ]
        : [],
      results: [],
      insights: {
        personal: { attempted: 0, averageScore: 0, score: 0, latestScore: 0 },
      },
    });
    let started = false;
    const mutate: DemoApi["mutate"] = async (action) => {
        if (action.type === "start-attempt") {
          started = true;
          return {
            type: "attempt-started",
            attempt: studentSnapshot(true).attempts[0]!,
          };
        }
        return {
          type: "attempt-submitted",
          attempt: {
            ...studentSnapshot(true).attempts[0]!,
            status: "submitted",
            submittedAt: "2026-08-27T00:10:00.000Z",
            responses: action.type === "submit-attempt" ? action.responses : [],
          },
          result: {
            attemptId: "attempt-1",
            assignmentId: "assignment-1",
            score: 1,
            totalMarks: 1,
            released: true,
            questionResults: [
              {
                questionId: "question-1",
                selectedChoiceId: "choice-speed",
                marksAwarded: 1,
              },
            ],
          },
        };
      };
    const api: DemoApi = {
      snapshot: vi.fn(async () => studentSnapshot(started)),
      mutate: vi.fn(mutate),
    };
    render(<DashboardPrototype api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue as student" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start test" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Speed" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit attempt" }));

    await vi.waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith({
        type: "submit-attempt",
        attemptId: "attempt-1",
        responses: [
          { questionId: "question-1", selectedChoiceId: "choice-speed" },
        ],
      }),
    );
  });

  it("restores the selected role after a reload", async () => {
    localStorage.setItem("vijeeta-dashboard-role", "teacher");
    const api: DemoApi = {
      snapshot: vi.fn(async () => ({
        role: "teacher" as const,
        session: { role: "teacher" as const, userId: "teacher-1", displayName: "Meera Shah", organisationId: "org-1" },
        organisation: { id: "org-1", name: "Aurora Academy" },
        classes: [],
        invites: [],
        quickTests: [],
        assignments: [],
        insights: { aggregate: { attempted: 0, pending: 0, averageScore: 0 }, individual: [] },
      })),
      mutate: vi.fn(),
    };

    render(<DashboardPrototype api={api} />);

    expect(await screen.findByRole("heading", { name: "No classes yet" })).toBeVisible();
    expect(api.snapshot).toHaveBeenCalledWith("teacher");
  });
});
