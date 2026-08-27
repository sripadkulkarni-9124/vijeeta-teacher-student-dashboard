import { describe, expect, it } from "vitest";
import {
  AdminBootstrapConfigSchema,
  ApiErrorSchema,
  AssignmentInsightsResponseSchema,
  AuditEventSchema,
  ClassroomAssignmentSchema,
  ClassroomInviteSchema,
  ClassroomSchema,
  DashboardProfileV2Schema,
  InviteClassroomMemberRequestSchema,
  UpdateActiveRoleRequestSchema,
  VerifiedPrincipalSchema,
} from "./connected-dashboard";

const timestamp = "2026-08-28T00:00:00.000Z";

describe("connected dashboard contracts", () => {
  it("requires a complete, server-owned profile", () => {
    expect(() => DashboardProfileV2Schema.parse({ firebaseUid: "u", roles: { admin: "active" } })).toThrow();

    const profile = DashboardProfileV2Schema.parse({
      internalProfileId: "profile-1",
      firebaseUid: "u",
      verifiedEmail: "student@example.com",
      displayName: "Student One",
      roles: { student: "active", teacher: "pending", admin: "active" },
      activeRole: "admin",
      onboardingCompleted: true,
      schemaVersion: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(profile.activeRole).toBe("admin");
    expect(() => DashboardProfileV2Schema.parse({ ...profile, clientRole: "admin" })).toThrow();
  });

  it("accepts only verified, normalized bootstrap emails", () => {
    expect(AdminBootstrapConfigSchema.parse({
      version: 1,
      verifiedEmails: ["admin@example.com"],
      firebaseUids: [],
    }).verifiedEmails).toEqual(["admin@example.com"]);

    expect(() => AdminBootstrapConfigSchema.parse({ version: 1, verifiedEmails: ["Admin@example.com"], firebaseUids: [] })).toThrow();
    expect(() => AdminBootstrapConfigSchema.parse({ version: 1, verifiedEmails: [], firebaseUids: [], unknown: true })).toThrow();
  });

  it("keeps the verified token principal free of asserted authorization", () => {
    const principal = VerifiedPrincipalSchema.parse({
      uid: "firebase-user-1",
      email: "teacher@example.com",
      emailVerified: true,
      displayName: "Teacher One",
      authTime: timestamp,
    });

    expect(principal.uid).toBe("firebase-user-1");
    expect(() => VerifiedPrincipalSchema.parse({
      uid: "firebase-user-1",
      email: "teacher@example.com",
      emailVerified: true,
      displayName: "Teacher One",
    })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, roles: { admin: "active" } })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, email: "Teacher@example.com" })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, authTime: "not-a-time" })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, authTime: `2026-08-28T00:00:00.${"0".repeat(80)}Z` })).toThrow();
  });

  it("rejects active assignments without a bounded immutable recipient snapshot", () => {
    expect(() => ClassroomAssignmentSchema.parse({ state: "active", recipientSnapshot: [] })).toThrow();

    const assignment = ClassroomAssignmentSchema.parse({
      id: "assignment-1",
      classroomId: "classroom-1",
      ownerUid: "teacher-1",
      jobId: "job-1",
      testId: "test-1",
      shareId: "share-1",
      state: "active",
      recipientSnapshot: [{ uid: "student-1", email: "student@example.com" }],
      openAt: timestamp,
      closeAt: "2026-08-28T01:00:00.000Z",
      solutions: "after_close",
      runnerPath: "/t/runner-token",
      reconciliation: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(assignment.recipientSnapshot).toHaveLength(1);
    expect(() => ClassroomAssignmentSchema.parse({ ...assignment, recipientSnapshot: [{ uid: "student-1", email: "Student@example.com" }] })).toThrow();
    expect(() => ClassroomAssignmentSchema.parse({ ...assignment, closeAt: null })).toThrow();
  });

  it("makes classroom and invitation records strict and safe to persist", () => {
    const classroom = ClassroomSchema.parse({
      id: "classroom-1",
      ownerUid: "teacher-1",
      name: "Physics A",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(classroom.name).toBe("Physics A");

    expect(() => ClassroomInviteSchema.parse({
      id: "invite-1",
      classroomId: "classroom-1",
      ownerUid: "teacher-1",
      normalizedEmail: "student@example.com",
      tokenDigest: "digest",
      tokenVersion: 1,
      expiresAt: timestamp,
      status: "pending",
      delivery: "pending",
      acceptedUid: null,
      acceptedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      rawToken: "not-persisted",
    })).toThrow();
  });

  it("rejects opaque insight payloads instead of passing through upstream data", () => {
    expect(() => AssignmentInsightsResponseSchema.parse({
      freshness: timestamp,
      insights: {
        aggregate: {
          attempted: 1,
          pending: 0,
          averageScore: 84,
          upstreamPayload: { answers: ["private answer"] },
        },
      },
    })).toThrow();
  });

  it("bounds redacted audit changes", () => {
    const event = {
      id: "audit-1",
      actorUid: "admin-1",
      actorProfileId: "profile-1",
      action: "teacher.approved",
      targetType: "profile",
      targetId: "teacher-1",
      reason: "Reviewed eligibility.",
      correlationId: "123e4567-e89b-12d3-a456-426614174000",
      canonicalLogInsertId: "log-1",
      createdAt: timestamp,
    };

    expect(() => AuditEventSchema.parse({
      ...event,
      before: { count: 1, entries: [{ field: "status", value: "x".repeat(241) }] },
    })).toThrow();
    expect(() => AuditEventSchema.parse({
      ...event,
      after: {
        count: 51,
        entries: Array.from({ length: 51 }, (_, index) => ({ field: `field-${index}`, value: "active" })),
      },
    })).toThrow();
    expect(AuditEventSchema.parse({
      ...event,
      before: { count: 1, entries: [{ field: "roles.teacher", value: "pending" }] },
      after: { count: 1, entries: [{ field: "roles.teacher", value: "active" }] },
    }).after?.entries[0]?.value).toBe("active");
  });

  it("caps ISO timestamps before datetime parsing", () => {
    const oversizedTimestamp = `2026-08-28T00:00:00.${"0".repeat(80)}Z`;
    expect(() => ClassroomSchema.parse({
      id: "classroom-1",
      ownerUid: "teacher-1",
      name: "Physics A",
      status: "active",
      createdAt: oversizedTimestamp,
      updatedAt: timestamp,
    })).toThrow();
  });

  it("validates strict route intents and stable safe errors", () => {
    expect(InviteClassroomMemberRequestSchema.parse({ email: "student@example.com" }).email).toBe("student@example.com");
    expect(() => InviteClassroomMemberRequestSchema.parse({ email: "student@example.com", uid: "forged" })).toThrow();
    expect(UpdateActiveRoleRequestSchema.parse({ activeRole: "student" }).activeRole).toBe("student");

    expect(ApiErrorSchema.parse({
      error: {
        code: "forbidden",
        message: "You are not allowed to perform this action.",
        correlationId: "123e4567-e89b-12d3-a456-426614174000",
        retryable: false,
      },
    }).error.retryable).toBe(false);
  });
});
