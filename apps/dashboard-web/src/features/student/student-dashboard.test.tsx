import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

import {
  StudentDashboard,
  type StudentDashboardSnapshot,
} from "./student-dashboard";

const readySnapshot: StudentDashboardSnapshot = {
  status: "ready",
  student: { id: "student-1", name: "Aarav Kulkarni", grade: "Class 11" },
  classes: [
    {
      id: "class-physics",
      name: "Class 11 Physics",
      teacherName: "Meera Shah",
      subject: "Physics",
    },
  ],
  tests: [
    {
      id: "test-assigned",
      title: "Physics foundations check",
      classId: "class-physics",
      subject: "Physics",
      status: "assigned",
      dueAt: "Tomorrow, 2:00 PM",
      durationMinutes: 20,
      questionCount: 10,
      questions: [
        {
          id: "question-speed",
          prompt: "Which quantity describes distance travelled per unit time?",
          choices: [
            { id: "choice-speed", label: "Speed" },
            { id: "choice-force", label: "Force" },
          ],
        },
        {
          id: "question-unit",
          prompt: "What is the SI unit of acceleration?",
          choices: [
            { id: "choice-ms", label: "m/s" },
            { id: "choice-ms2", label: "m/s²" },
          ],
        },
      ],
    },
    {
      id: "test-pending",
      title: "Units revision",
      classId: "class-physics",
      subject: "Physics",
      status: "pending",
      dueAt: "Friday, 2:00 PM",
      durationMinutes: 15,
      questionCount: 8,
    },
    {
      id: "test-attempted",
      title: "Kinematics checkpoint",
      classId: "class-physics",
      subject: "Physics",
      status: "submitted",
      score: 8,
      totalMarks: 10,
      resultSummary: "Strong start; revisit acceleration graphs.",
    },
  ],
  selectedTestId: "test-assigned",
  insights: {
    testsCompleted: 3,
    averageScore: "78%",
    focusArea: "Acceleration graphs",
  },
};

afterEach(cleanup);

describe("StudentDashboard", () => {
  it("groups tests, shows the selected detail, class context, and personal insights", () => {
    render(
      createElement(StudentDashboard, {
        onStartAttempt: vi.fn(async () => undefined),
        onSubmitAttempt: vi.fn(async () => undefined),
        snapshot: readySnapshot,
      }),
    );

    expect(screen.getByRole("heading", { name: /aarav/i })).toBeVisible();
    expect(screen.getByRole("heading", { name: "My classes" })).toBeVisible();
    expect(screen.getByText("Class 11 Physics")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Assigned tests" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Pending tests" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Attempted tests" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Physics foundations check" }),
    ).toBeVisible();
    expect(screen.getByText("Tests completed")).toBeVisible();
    expect(screen.getByText("Acceleration graphs")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start test" })).toBeVisible();
  });

  it("requires every answer and submits the learner's selected choices", async () => {
    const onStartAttempt = vi.fn(async () => undefined);
    const onSubmitAttempt = vi.fn(async () => undefined);
    render(
      createElement(StudentDashboard, {
        onStartAttempt,
        onSubmitAttempt,
        snapshot: readySnapshot,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start test" }));
    await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith("test-assigned"));
    expect(screen.getAllByText("In progress")[0]).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit attempt" })).toBeVisible();
    expect(
      screen.getByRole("group", {
        name: "Question 1: Which quantity describes distance travelled per unit time?",
      }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: "Speed" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "m/s²" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Submit attempt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Answer every question before submitting. 2 answers are missing.",
    );
    expect(onSubmitAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Speed" }));
    fireEvent.click(screen.getByRole("radio", { name: "m/s²" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit attempt" }));

    await waitFor(() =>
      expect(onSubmitAttempt).toHaveBeenCalledWith("test-assigned", [
        { questionId: "question-speed", selectedChoiceId: "choice-speed" },
        { questionId: "question-unit", selectedChoiceId: "choice-ms2" },
      ]),
    );
    expect(screen.getAllByText("Submitted")[0]).toBeVisible();
    expect(screen.getByText(/result will appear here/i)).toBeVisible();
  });

  it.each([
    ["loading", "Loading your student dashboard"],
    ["empty", "No tests assigned yet"],
    ["error", "We could not load your student dashboard"],
  ] as const)("renders the practical %s state", (status, message) => {
    render(
      createElement(StudentDashboard, {
        onStartAttempt: vi.fn(async () => undefined),
        onSubmitAttempt: vi.fn(async () => undefined),
        snapshot: { ...readySnapshot, status },
      }),
    );

    expect(screen.getByRole(status === "error" ? "alert" : "status")).toHaveTextContent(
      message,
    );
  });
});
