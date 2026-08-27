import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TeacherDashboard,
  type TeacherDashboardSnapshot,
} from "./teacher-dashboard";

const snapshot: TeacherDashboardSnapshot = {
  scenario: "ready",
  teacher: {
    name: "Meera Shah",
    organisation: "Aurora Academy",
  },
  classes: [
    {
      id: "class-11-physics",
      name: "Class 11 Physics",
      studentCount: 24,
      subject: "Physics",
    },
  ],
  roster: [
    {
      id: "student-aarav",
      name: "Aarav Kulkarni",
      email: "aarav@example.test",
      status: "attempted",
      score: "8 / 8",
    },
    {
      id: "student-sana",
      name: "Sana Iyer",
      email: "sana@example.test",
      status: "not-attempted",
    },
  ],
  invitations: [],
  tests: [
    {
      id: "test-physics",
      title: "Physics foundations check",
      topic: "Motion",
      questionCount: 10,
      difficulty: "Mixed",
      status: "assigned",
      assignedClassId: "class-11-physics",
      attemptedCount: 1,
      totalStudents: 2,
    },
  ],
  insights: {
    attemptedCount: 1,
    totalStudents: 2,
    averageScore: "8 / 8",
    strongestTopic: "Units and measurement",
    students: [
      { studentId: "student-aarav", summary: "Ready for extension work" },
      { studentId: "student-sana", summary: "Needs a first attempt" },
    ],
  },
};

describe("TeacherDashboard", () => {
  afterEach(cleanup);

  it("shows class roster, aggregate insight, and attempted roster by default", () => {
    render(<TeacherDashboard snapshot={snapshot} />);

    expect(screen.getByRole("heading", { level: 1, name: /teacher dashboard/i })).toBeVisible();
    expect(screen.getByRole("article", { name: "Class 11 Physics" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Aarav Kulkarni" })).toHaveTextContent(
      "8 / 8",
    );
    expect(screen.getByRole("status", { name: /class insight/i })).toHaveTextContent(
      "1 of 2 attempted",
    );
    expect(screen.getByText(/Units and measurement/)).toBeVisible();
  });

  it("switches between attempted and not-attempted roster tabs", () => {
    render(<TeacherDashboard snapshot={snapshot} />);

    fireEvent.click(screen.getByRole("tab", { name: "Not attempted" }));
    expect(screen.getByRole("article", { name: "Sana Iyer" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "Aarav Kulkarni" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Attempted" }));
    expect(screen.getByRole("article", { name: "Aarav Kulkarni" })).toBeVisible();
  });

  it("creates an invitation through a preview-only email or WhatsApp form", async () => {
    const onCreateInvitation = vi.fn(async () => ({
      status: "preview" as const,
      summary: "Preview ready for sana@example.test",
    }));
    render(
      <TeacherDashboard
        onCreateInvitation={onCreateInvitation}
        snapshot={snapshot}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Invite recipient" }), {
      target: { value: "sana@example.test" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Invite channel" }), {
      target: { value: "email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview invitation" }));

    await waitFor(() => expect(onCreateInvitation).toHaveBeenCalledWith({
      channel: "email",
      recipient: "sana@example.test",
    }));
    expect(await screen.findByRole("status", { name: /invitation state/i })).toHaveTextContent(
      "Preview ready",
    );
    expect(screen.getByText(/no invitation was sent/i)).toBeVisible();
  });

  it("creates a quick test draft and exposes collapsed advanced settings", async () => {
    const onCreateQuickTestDraft = vi.fn(async (input) => ({
      status: "created" as const,
      summary: `${input.topic} draft ready`,
    }));
    render(
      <TeacherDashboard
        onCreateQuickTestDraft={onCreateQuickTestDraft}
        snapshot={snapshot}
      />,
    );

    expect(screen.queryByLabelText("Duration (minutes)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    expect(screen.getByLabelText(/Duration \(minutes\)/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Negative marking" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Test topic" }), {
      target: { value: "Kinematics" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Question count" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Difficulty" }), {
      target: { value: "Hard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create quick test draft" }));

    await waitFor(() => expect(onCreateQuickTestDraft).toHaveBeenCalledWith({
      topic: "Kinematics",
      questionCount: 12,
      difficulty: "Hard",
      durationMinutes: 20,
      negativeMarking: false,
      releasePolicy: "after-test",
    }));
    expect(await screen.findByRole("status", { name: /quick test state/i })).toHaveTextContent(
      "Kinematics draft ready",
    );
  });

  it("previews assignment scope and flags direct-email exceptions", async () => {
    const onAssignTest = vi.fn(async () => ({
      status: "preview" as const,
      summary: "Assignment preview ready",
    }));
    render(<TeacherDashboard onAssignTest={onAssignTest} snapshot={snapshot} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Assignment class" }), {
      target: { value: "class-11-physics" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Direct email exceptions" }), {
      target: { value: "late.student@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview assignment" }));

    await waitFor(() => expect(onAssignTest).toHaveBeenCalledWith({
      testId: "test-physics",
      classId: "class-11-physics",
      directEmailExceptions: ["late.student@example.test"],
    }));
    const preview = await screen.findByRole("status", { name: /assignment state/i });
    expect(preview).toHaveTextContent("Assignment preview ready");
    expect(screen.getByText(/Direct email exceptions: 1/)).toBeVisible();
  });

  it.each([
    ["loading", "Loading teacher dashboard"],
    ["empty", "No classes yet"],
    ["error", "We could not load the teacher dashboard"],
  ] as const)("renders the %s state", (scenario, message) => {
    render(<TeacherDashboard snapshot={{ ...snapshot, scenario, classes: [] }} />);
    expect(screen.getByText(message)).toBeVisible();
  });
});
