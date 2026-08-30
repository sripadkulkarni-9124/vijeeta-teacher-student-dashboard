import { describe, expect, it } from "vitest";
import {
  DashboardAssignmentSchema,
  DashboardSnapshotSchema,
  QuickTestDraftSchema,
  TeacherDashboardSnapshotSchema,
  StudentDashboardSnapshotSchema,
  parseDashboardAction,
  parseDashboardDispatchResult,
  parseDashboardSnapshot,
  assignmentAccessOf,
  assignmentRequiresLogin,
} from "./dashboard";

describe("dashboard contracts", () => {
  it("accepts a quick-test draft with More settings", () => {
    const draft = QuickTestDraftSchema.parse({
      id: "draft-1",
      topic: "Kinematics",
      questionCount: 10,
      difficulty: "mixed",
      durationMinutes: 20,
      negativeMarking: true,
      releasePolicy: "after-test",
      status: "draft",
      createdAt: "2026-08-27T00:00:00.000Z",
    });

    expect(draft.negativeMarking).toBe(true);
  });

  it("keeps actions a strict discriminated union", () => {
    expect(parseDashboardAction({
      type: "create-assignment",
      testId: "draft-1",
      title: "Kinematics check",
      classIds: ["class-a"],
      directEmails: ["family@example.com"],
    }).type).toBe("create-assignment");

    expect(() => parseDashboardAction({ type: "create-assignment", testId: "x", nope: true })).toThrow();
  });

  it("accepts role-specific snapshots and rejects cross-role shapes", () => {
    const teacher = TeacherDashboardSnapshotSchema.parse({
      role: "teacher",
      session: { role: "teacher", userId: "teacher-1", displayName: "Meera Shah", organisationId: "org-1" },
      organisation: { id: "org-1", name: "Aurora Academy" },
      classes: [],
      invites: [],
      quickTests: [],
      assignments: [],
      insights: { aggregate: { attempted: 0, pending: 0, averageScore: 0 }, individual: [] },
    });
    expect(teacher.role).toBe("teacher");

    expect(() => StudentDashboardSnapshotSchema.parse(teacher)).toThrow();
    expect(parseDashboardSnapshot(teacher)).toEqual(teacher);
    expect(DashboardSnapshotSchema.parse(teacher).role).toBe("teacher");
  });

  it("validates successful mutation envelopes", () => {
    const result = parseDashboardDispatchResult({
      type: "student-invited",
      invite: {
        id: "invite-1",
        email: "learner@example.test",
        classId: "class-1",
        status: "pending",
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    });

    expect(result.type).toBe("student-invited");
    expect(() => parseDashboardDispatchResult({ type: "student-invited", invite: {} })).toThrow();
  });

  it("defaults assignments without an access field to email addressing with login required", () => {
    const assignment = DashboardAssignmentSchema.parse({
      id: "assignment-1",
      testId: "test-1",
      title: "Kinematics check",
      recipients: [{ kind: "class", id: "class-1", label: "Class 11 Physics", status: "pending" }],
      createdAt: "2026-08-27T00:00:00.000Z",
    });

    expect(assignment.access).toBeUndefined();
    expect(assignmentAccessOf(assignment)).toBe("email");
    expect(assignmentRequiresLogin(assignment)).toBe(true);
  });

  it("allows an empty recipient list only for link-mode assignments", () => {
    const link = DashboardAssignmentSchema.parse({
      id: "assignment-2",
      testId: "test-1",
      title: "Shared revision",
      access: "link",
      requireLogin: false,
      recipients: [],
      createdAt: "2026-08-27T00:00:00.000Z",
    });

    expect(assignmentAccessOf(link)).toBe("link");
    expect(assignmentRequiresLogin(link)).toBe(false);
    expect(() => DashboardAssignmentSchema.parse({
      id: "assignment-3",
      testId: "test-1",
      title: "Empty email assignment",
      access: "email",
      recipients: [],
      createdAt: "2026-08-27T00:00:00.000Z",
    })).toThrow();
  });

  it("records redeemed link grants as their own recipient kind", () => {
    const assignment = DashboardAssignmentSchema.parse({
      id: "assignment-4",
      testId: "test-1",
      title: "Shared revision",
      access: "link",
      requireLogin: true,
      recipients: [{ kind: "link", studentId: "student-1", status: "pending", grantedAt: "2026-08-27T00:00:00.000Z" }],
      createdAt: "2026-08-27T00:00:00.000Z",
    });

    expect(assignment.recipients[0]).toEqual(expect.objectContaining({ kind: "link", studentId: "student-1" }));
    expect(() => DashboardAssignmentSchema.parse({
      ...assignment,
      recipients: [{ kind: "link", studentId: "student-1", status: "pending", grantedAt: "2026-08-27T00:00:00.000Z", token: "leaked" }],
    })).toThrow();
  });

  it("accepts link-mode assignment creation without recipients and validates redemption tokens", () => {
    const created = parseDashboardAction({
      type: "create-assignment",
      testId: "draft-1",
      title: "Shared revision",
      access: "link",
      requireLogin: false,
    });

    expect(created.type).toBe("create-assignment");
    if (created.type === "create-assignment") expect(created.classIds).toEqual([]);
    expect(() => parseDashboardAction({ type: "create-assignment", testId: "draft-1", title: "No recipients" })).toThrow();

    const token = "a".repeat(43);
    expect(parseDashboardAction({ type: "redeem-assignment-link", assignmentId: "assignment-2", token }).type)
      .toBe("redeem-assignment-link");
    expect(() => parseDashboardAction({ type: "redeem-assignment-link", assignmentId: "assignment-2", token: "short" })).toThrow();
    expect(() => parseDashboardAction({ type: "redeem-assignment-link", assignmentId: "assignment-2", token, studentId: "forged" })).toThrow();
  });
});
