import { describe, expect, it } from "vitest";
import {
  DashboardSnapshotSchema,
  QuickTestDraftSchema,
  TeacherDashboardSnapshotSchema,
  StudentDashboardSnapshotSchema,
  parseDashboardAction,
  parseDashboardDispatchResult,
  parseDashboardSnapshot,
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
});
