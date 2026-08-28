import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentInsightsResponse,
  ClassroomAssignmentListResponse,
  ClassroomListResponse,
} from "@vijeeta/api-contracts";

import {
  ConnectedStudentDashboard,
  STUDENT_CLIENT_METHODS,
  isSafeRunnerPath,
  studentFailureCopy,
  type StudentDashboardApi,
} from "./connected-student-dashboard";

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

const now = "2026-08-28T10:00:00.000Z";

const classrooms: ClassroomListResponse = {
  classrooms: [{ id: "class-1", ownerUid: "teacher-1", name: "Grade 12 Physics", status: "active", createdAt: now, updatedAt: now }],
  nextCursor: null,
};

const assignments: ClassroomAssignmentListResponse = {
  assignments: [{
    id: "assignment-1",
    classroomId: "class-1",
    ownerUid: "teacher-1",
    jobId: "JOB-1",
    recipientCount: 1,
    openAt: now,
    closeAt: null,
    solutions: "on_submit",
    state: "active",
    testId: "test-1",
    shareId: "share-1",
    reconciliation: null,
    createdAt: now,
    updatedAt: now,
  }],
  nextCursor: null,
};

const personalInsights: AssignmentInsightsResponse = {
  freshness: now,
  insights: { personal: { attempted: 1, averageScore: 70, score: 68, latestScore: 68 } },
};

function api(overrides: Partial<StudentDashboardApi> = {}): StudentDashboardApi {
  return {
    listClasses: vi.fn(async () => classrooms),
    listAssignments: vi.fn(async () => assignments),
    launchAssignment: vi.fn(async () => ({ runnerPath: "/v3/runner/share-1" })),
    getAssignmentInsights: vi.fn(async () => personalInsights),
    ...overrides,
  };
}

describe("connected student dashboard", () => {
  it("requests no teacher or admin capability", () => {
    expect(STUDENT_CLIENT_METHODS).not.toContain("createClassroom");
    expect(STUDENT_CLIENT_METHODS).not.toContain("inviteClassroomMember");
    expect(STUDENT_CLIENT_METHODS).not.toContain("getStudentAssignmentInsights");
    expect(STUDENT_CLIENT_METHODS).not.toContain("listAdminProfiles");
  });

  it("lists the student's own classes and assigned tests", async () => {
    const dependencies = api();
    render(<ConnectedStudentDashboard api={dependencies} />);

    expect(await screen.findByText("JOB-1")).toBeInTheDocument();
    expect(screen.getByText("Grade 12 Physics")).toBeInTheDocument();
    expect(dependencies.listAssignments).toHaveBeenCalledWith("class-1", { limit: 50 });
  });

  it("shows an empty state when the student has no class yet", async () => {
    render(<ConnectedStudentDashboard api={api({ listClasses: vi.fn(async () => ({ classrooms: [], nextCursor: null })) })} />);
    expect(await screen.findByText(/Accept an invitation from your teacher/)).toBeInTheDocument();
  });

  it("launches an active assignment through the server-validated runner path", async () => {
    const onLaunch = vi.fn();
    const dependencies = api();
    render(<ConnectedStudentDashboard api={dependencies} onLaunch={onLaunch} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start test" }));

    await waitFor(() => expect(dependencies.launchAssignment).toHaveBeenCalledWith("assignment-1"));
    expect(onLaunch).toHaveBeenCalledWith("/v3/runner/share-1");
  });

  it("refuses a launch target that is not a same-origin relative path", async () => {
    const onLaunch = vi.fn();
    render(<ConnectedStudentDashboard api={api({ launchAssignment: vi.fn(async () => ({ runnerPath: "//evil.example/steal" })) })} onLaunch={onLaunch} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("launch target was rejected");
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("classifies runner paths", () => {
    expect(isSafeRunnerPath("/v3/runner/abc")).toBe(true);
    expect(isSafeRunnerPath("//evil.example")).toBe(false);
    expect(isSafeRunnerPath("https://evil.example")).toBe(false);
    expect(isSafeRunnerPath(`/${"a".repeat(600)}`)).toBe(false);
  });

  it("shows the student's own released result", async () => {
    const dependencies = api();
    render(<ConnectedStudentDashboard api={dependencies} />);

    fireEvent.click(await screen.findByRole("button", { name: "View result" }));
    await waitFor(() => expect(dependencies.getAssignmentInsights).toHaveBeenCalledWith("assignment-1"));

    window.location.hash = "#student-results";
    fireEvent(window, new HashChangeEvent("hashchange"));

    const performance = await screen.findByRole("region", { name: "Your performance" });
    expect(within(performance).getAllByText("68")).toHaveLength(2);
    expect(within(performance).getByText("70")).toBeInTheDocument();
  });

  it("denies access without echoing server text", async () => {
    const denied = Object.assign(new Error("raw server detail"), { status: 403 });
    const onAuthorizationLost = vi.fn();
    render(<ConnectedStudentDashboard api={api({ listClasses: vi.fn(async () => { throw denied; }) })} onAuthorizationLost={onAuthorizationLost} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Student access could not be verified");
    expect(screen.queryByText("raw server detail")).not.toBeInTheDocument();
    expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
  });

  it("never echoes an unsafe correlation id", () => {
    expect(studentFailureCopy({ status: 500, correlationId: "<script>" }).message).not.toContain("script");
    expect(studentFailureCopy({ status: 500, correlationId: "req-9" }).message).toContain("req-9");
  });
});
