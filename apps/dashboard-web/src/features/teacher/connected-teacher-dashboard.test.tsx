import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentInsightsResponse,
  ClassroomAssignmentListResponse,
  ClassroomListResponse,
  ClassroomRosterResponse,
} from "@vijeeta/api-contracts";

import {
  ConnectedTeacherDashboard,
  TEACHER_CLIENT_METHODS,
  teacherFailureCopy,
  type TeacherDashboardApi,
} from "./connected-teacher-dashboard";

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

const now = "2026-08-28T10:00:00.000Z";

const classrooms: ClassroomListResponse = {
  classrooms: [{ id: "class-1", ownerUid: "teacher-1", name: "Grade 12 Physics", status: "active", createdAt: now, updatedAt: now }],
  nextCursor: null,
};

const roster: ClassroomRosterResponse = {
  members: [{ studentUid: "student-1", displayName: "Aarav Sharma", status: "active", joinedAt: now }],
  invitations: [{ id: "invite-1", maskedEmail: "p***a@school.edu", expiresAt: now, status: "pending", delivery: "sent", createdAt: now, updatedAt: now }],
  nextMemberCursor: null,
  nextInvitationCursor: null,
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

const aggregateInsights: AssignmentInsightsResponse = {
  freshness: now,
  insights: { aggregate: { attempted: 1, pending: 0, averageScore: 72 } },
};

function api(overrides: Partial<TeacherDashboardApi> = {}): TeacherDashboardApi {
  return {
    listClasses: vi.fn(async () => classrooms),
    createClassroom: vi.fn(async () => ({ classroom: { id: "class-2", ownerUid: "teacher-1", name: "Grade 11 Maths", status: "active" as const, createdAt: now, updatedAt: now } })),
    archiveClassroom: vi.fn(async () => ({ classroom: { ...classrooms.classrooms[0]!, status: "archived" as const } })),
    getClassroomRoster: vi.fn(async () => roster),
    inviteClassroomMember: vi.fn(async () => ({ invite: { id: "invite-2", classroomId: "class-1", ownerUid: "teacher-1", tokenVersion: 1, expiresAt: now, status: "pending" as const, delivery: "sent" as const, acceptedUid: null, acceptedAt: null, createdAt: now, updatedAt: now } })),
    revokeClassroomInvitation: vi.fn(async () => ({ invite: { id: "invite-1", classroomId: "class-1", ownerUid: "teacher-1", tokenVersion: 1, expiresAt: now, status: "revoked" as const, delivery: "sent" as const, acceptedUid: null, acceptedAt: null, createdAt: now, updatedAt: now } })),
    redeliverClassroomInvitation: vi.fn(async () => ({ invite: { id: "invite-1", classroomId: "class-1", ownerUid: "teacher-1", tokenVersion: 2, expiresAt: now, status: "pending" as const, delivery: "redelivery_requested" as const, acceptedUid: null, acceptedAt: null, createdAt: now, updatedAt: now } })),
    listAssignments: vi.fn(async () => assignments),
    createAssignment: vi.fn(async () => ({ assignment: assignments.assignments[0]! })),
    getAssignmentInsights: vi.fn(async () => aggregateInsights),
    getStudentAssignmentInsights: vi.fn(async () => ({
      freshness: now,
      insights: { individual: { uid: "student-1", displayName: "Aarav Sharma", score: 68, status: "attempted" as const } },
    })),
    ...overrides,
  };
}

describe("connected teacher dashboard", () => {
  it("declares only the teacher client methods it uses", () => {
    expect(new Set(TEACHER_CLIENT_METHODS).size).toBe(TEACHER_CLIENT_METHODS.length);
    expect(TEACHER_CLIENT_METHODS).not.toContain("listAdminProfiles");
    expect(TEACHER_CLIENT_METHODS).not.toContain("approveTeacher");
  });

  it("loads owned classes and the roster for the first class", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);

    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());
    expect(dependencies.getClassroomRoster).toHaveBeenCalledWith("class-1", { limit: 50 });
    expect(dependencies.listAssignments).toHaveBeenCalledWith("class-1", { limit: 50 });
  });

  it("creates a class and selects it", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("New class name"), { target: { value: "Grade 11 Maths" } });
    fireEvent.click(screen.getByRole("button", { name: "Create class" }));

    await waitFor(() => expect(dependencies.createClassroom).toHaveBeenCalledWith({ name: "Grade 11 Maths" }));
    expect(await screen.findByText("Class created")).toBeInTheDocument();
  });

  it("invites a student with a normalized email and refreshes the roster", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());

    window.location.hash = "#teacher-roster";
    fireEvent(window, new HashChangeEvent("hashchange"));

    fireEvent.click(await screen.findByRole("button", { name: "Invite students" }));
    fireEvent.change(screen.getByLabelText("Student email"), { target: { value: "  Priya@School.edu " } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(dependencies.inviteClassroomMember).toHaveBeenCalledWith("class-1", { email: "priya@school.edu" }));
    expect(await screen.findByText("Invitation recorded")).toBeInTheDocument();
  });

  it("revokes and redelivers a pending invitation", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());
    window.location.hash = "#teacher-roster";
    fireEvent(window, new HashChangeEvent("hashchange"));

    fireEvent.click(await screen.findByRole("button", { name: "Redeliver" }));
    await waitFor(() => expect(dependencies.redeliverClassroomInvitation).toHaveBeenCalledWith("class-1", "invite-1"));

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(dependencies.revokeClassroomInvitation).toHaveBeenCalledWith("class-1", "invite-1"));
  });

  it("schedules an assignment against the selected class", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());
    window.location.hash = "#teacher-assignments";
    fireEvent(window, new HashChangeEvent("hashchange"));

    fireEvent.change(await screen.findByLabelText("Test job ID"), { target: { value: "JOB-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign to class" }));

    await waitFor(() => expect(dependencies.createAssignment).toHaveBeenCalledTimes(1));
    const [classId, body] = vi.mocked(dependencies.createAssignment).mock.calls[0]!;
    expect(classId).toBe("class-1");
    expect(body.jobId).toBe("JOB-9");
    expect(body.solutions).toBe("on_submit");
  });

  it("shows aggregate insights and then an authorized individual result", async () => {
    const dependencies = api();
    render(<ConnectedTeacherDashboard api={dependencies} />);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Grade 12 Physics" })).toBeInTheDocument());
    window.location.hash = "#teacher-assignments";
    fireEvent(window, new HashChangeEvent("hashchange"));

    fireEvent.click(await screen.findByRole("button", { name: "View insights" }));
    await waitFor(() => expect(dependencies.getAssignmentInsights).toHaveBeenCalledWith("assignment-1"));

    window.location.hash = "#teacher-insights";
    fireEvent(window, new HashChangeEvent("hashchange"));
    const insights = await screen.findByRole("region", { name: "Aggregate results" });
    expect(within(insights).getByText("72")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View student result" }));
    await waitFor(() => expect(dependencies.getStudentAssignmentInsights).toHaveBeenCalledWith("assignment-1", "student-1"));
  });

  it("reports a denial without echoing server text and stops rendering data", async () => {
    const denied = Object.assign(new Error("nope"), { status: 403, code: "forbidden" });
    const onAuthorizationLost = vi.fn();
    render(<ConnectedTeacherDashboard api={api({ listClasses: vi.fn(async () => { throw denied; }) })} onAuthorizationLost={onAuthorizationLost} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Teacher access could not be verified");
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
    expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
  });

  it("never echoes an unsafe correlation id", () => {
    expect(teacherFailureCopy({ status: 500, correlationId: "../../etc/passwd" }).message).not.toContain("passwd");
    expect(teacherFailureCopy({ status: 500, correlationId: "abc-123" }).message).toContain("abc-123");
    expect(teacherFailureCopy({ status: 401 }).denied).toBe(true);
  });
});
