import { describe, expect, it } from "vitest";
import {
  AdminBootstrapConfigSchema,
  AdminInvitationListResponseSchema,
  ApiErrorSchema,
  AssignmentInsightsResponseSchema,
  AuditEventSchema,
  ClassroomAssignmentSchema,
  ClassroomAssignmentResponseSchema,
  ClassroomInviteSchema,
  ClassroomRosterResponseSchema,
  ClassroomSchema,
  DashboardProfileV2Schema,
  InviteClassroomMemberRequestSchema,
  InspectInvitationResponseSchema,
  UpdateActiveRoleRequestSchema,
  V3IndividualTestInsightSchema,
  V3OwnedJobsSchema,
  V3ShareResultSchema,
  V3ShareResultsSchema,
  V3StudentTestListSchema,
  V3StudentTestReadSchema,
  V3StudentTestReviewSchema,
  V3ScheduleTimestampSchema,
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

  it("models an honest redelivery request without exposing invitation secrets", () => {
    const invite = {
      id: "invite-1",
      classroomId: "classroom-1",
      ownerUid: "teacher-1",
      normalizedEmail: "student@example.com",
      tokenDigest: "d".repeat(64),
      tokenVersion: 1,
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "pending" as const,
      delivery: "redelivery_requested" as const,
      acceptedUid: null,
      acceptedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(ClassroomInviteSchema.parse(invite).delivery).toBe("redelivery_requested");
    expect(AdminInvitationListResponseSchema.parse({ invitations: [{
      id: invite.id,
      classroomId: invite.classroomId,
      ownerUid: invite.ownerUid,
      tokenVersion: invite.tokenVersion,
      expiresAt: invite.expiresAt,
      status: invite.status,
      delivery: invite.delivery,
      acceptedUid: invite.acceptedUid,
      acceptedAt: invite.acceptedAt,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
    }], nextCursor: null }).invitations).toHaveLength(1);
    expect(() => AdminInvitationListResponseSchema.parse({
      invitations: [{ ...invite, rawToken: "secret" }],
      nextCursor: null,
    })).toThrow();
    expect(AuditEventSchema.parse({
      id: "audit-redelivery",
      actorUid: "admin-1",
      actorProfileId: "profile-1",
      action: "invite.redelivery_requested",
      targetType: "invite",
      targetId: invite.id,
      reason: "Recipient requested a fresh link",
      correlationId: "123e4567-e89b-12d3-a456-426614174000",
      canonicalLogInsertId: "audit-redelivery",
      createdAt: timestamp,
    }).action).toBe("invite.redelivery_requested");
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

  it("projects assignment responses without recipient identities", () => {
    const assignment = {
      id: "assignment-1", classroomId: "class-1", ownerUid: "teacher-1", jobId: "job-1",
      recipientSnapshot: [{ uid: "student-1", email: "student@example.com" }],
      openAt: "2026-08-28T07:00:00.000Z", closeAt: "2026-08-28T09:00:00.000Z", solutions: "after_close",
      state: "active", testId: "test-1", shareId: "share-1", runnerPath: "/t/abcdefghijklmnop",
      reconciliation: null, createdAt: timestamp, updatedAt: timestamp,
    };
    const projected = ClassroomAssignmentResponseSchema.parse({ assignment });
    expect(projected.assignment).toMatchObject({ id: "assignment-1", recipientCount: 1 });
    expect(projected.assignment).not.toHaveProperty("recipientSnapshot");
    expect(JSON.stringify(projected)).not.toContain("student@example.com");
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
    expect(InviteClassroomMemberRequestSchema.parse({ email: " Student@Example.COM " }).email).toBe("student@example.com");
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

  it("reports ambiguous invitation delivery without exposing transport or token data", () => {
    const invite = ClassroomInviteSchema.parse({
      id: "invite-1",
      classroomId: "classroom-1",
      ownerUid: "teacher-1",
      normalizedEmail: "student@example.com",
      tokenDigest: "d".repeat(64),
      tokenVersion: 1,
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "pending",
      delivery: "unknown",
      deliveryErrorCategory: "ambiguous",
      acceptedUid: null,
      acceptedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(invite.delivery).toBe("unknown");
    expect(() => ClassroomInviteSchema.parse({ ...invite, providerPayload: { token: "secret" } })).toThrow();
  });

  it("bounds roster projections and invitation inspection to redacted fields", () => {
    const roster = ClassroomRosterResponseSchema.parse({
      members: [{
        studentUid: "student-1",
        displayName: "Student One",
        status: "active",
        joinedAt: timestamp,
      }],
      invitations: [{
        id: "invite-1",
        maskedEmail: "s***@example.com",
        expiresAt: "2026-09-04T00:00:00.000Z",
        status: "pending",
        delivery: "unknown",
        deliveryErrorCategory: "ambiguous",
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      nextMemberCursor: null,
      nextInvitationCursor: null,
    });
    expect(roster.invitations[0]?.maskedEmail).toBe("s***@example.com");
    expect(() => ClassroomRosterResponseSchema.parse({ ...roster, invitations: [{ ...roster.invitations[0], normalizedEmail: "student@example.com" }] })).toThrow();

    const inspected = InspectInvitationResponseSchema.parse({
      inviteId: "invite-1",
      classroomId: "classroom-1",
      classroomName: "Physics A",
      teacherDisplayName: "Teacher One",
      targetEmailMatches: true,
      studentOnboardingRequired: true,
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "pending",
    });
    expect(inspected.targetEmailMatches).toBe(true);
    expect(() => InspectInvitationResponseSchema.parse({ ...inspected, targetEmail: "student@example.com", tokenDigest: "d".repeat(64) })).toThrow();
  });

  it("strictly projects bounded V3 assignment DTOs", () => {
    const jobs = V3OwnedJobsSchema.parse({
      jobs: [
        { id: "JOB-1", title: "Mechanics", status: "final" },
        { id: "JOB-2", title: "Optics", status: "revising" },
      ],
      page: 1,
      pageSize: 50,
      total: 2,
      pages: 1,
    });
    expect(jobs.jobs[0]?.id).toBe("JOB-1");
    expect(jobs.jobs[1]?.status).toBe("revising");
    expect(() => V3OwnedJobsSchema.parse({ ...jobs, jobs: [{ id: "JOB-3", title: "Invented", status: "built" }] })).toThrow();
    expect(() => V3OwnedJobsSchema.parse({ ...jobs, jobs: [{ id: "JOB-3", title: "Invented", status: "trashed" }] })).toThrow();
    expect(() => V3OwnedJobsSchema.parse({ ...jobs, key: "legacy-admin" })).toThrow();

    const shared = V3ShareResultSchema.parse({
      shareId: "SH-1",
      testId: "shared-job-1",
      runnerPath: "/t/opaque-capability",
      readout: { resolved: 1, batches: 0, warnings: [] },
    });
    expect(shared.runnerPath).toBe("/t/opaque-capability");
    expect(() => V3ShareResultSchema.parse({ ...shared, token: "opaque-capability" })).toThrow();
  });

  it("accepts only canonical integral RFC3339 V3 schedule timestamps", () => {
    expect(V3ScheduleTimestampSchema.parse("2026-08-28T00:00:00Z")).toBe("2026-08-28T00:00:00Z");
    expect(V3ScheduleTimestampSchema.parse("2026-08-28T05:30:00+05:30")).toBe("2026-08-28T05:30:00+05:30");
    expect(V3ScheduleTimestampSchema.parse("2026-08-28T00:00:00.000Z")).toBe("2026-08-28T00:00:00.000Z");
    for (const invalid of [
      "2026-08-28",
      "2026-08-28 00:00:00Z",
      "2026-08-28t00:00:00z",
      "2026-08-28T00:00:00",
      "2026-08-28T00:00:00.500Z",
      "2026-08-28T00:00:00+0530",
      "2026-08-28T00:00:00-00:00",
      "2026-02-30T00:00:00Z",
      "9999-12-31T23:59:59Z",
    ]) expect(() => V3ScheduleTimestampSchema.parse(invalid)).toThrow();
  });

  it("keeps V3 insight DTOs free of email, answers, and raw attempt payloads", () => {
    const aggregate = V3ShareResultsSchema.parse({
      shareId: "SH-1",
      testId: "shared-job-1",
      funnel: { shared: 2, attempted: 1, pending: 1 },
      averageScore: 42,
      students: [{ uid: "student-1", attempted: true, score: 42, maxScore: 100, accuracy: 0.5, timeMs: 1200 }],
    });
    expect(aggregate.students[0]).not.toHaveProperty("email");
    expect(() => V3ShareResultsSchema.parse({ ...aggregate, pendingEmails: ["student@example.com"] })).toThrow();

    const individual = V3IndividualTestInsightSchema.parse({
      uid: "student-1",
      testId: "shared-job-1",
      available: true,
      title: "Mechanics",
      score: 42,
      maxScore: 100,
      percentile: 80,
      deltaFromPrevious: 5,
    });
    expect(() => V3IndividualTestInsightSchema.parse({ ...individual, answers: [{ qid: "q1", answer: 2 }] })).toThrow();
  });

  it("strictly bounds Student V3 read, launch, and review projections", () => {
    const tests = V3StudentTestListSchema.parse({
      tests: [{
        testId: "shared-job-1",
        title: "Mechanics",
        teacherLabel: "teacher",
        kind: "main",
        sharedAtEpochSeconds: 1_787_808_000,
        state: "open",
        score: null,
        maxScore: null,
        runnerPath: "/t/opaque-capability",
      }],
    });
    expect(tests.tests).toHaveLength(1);

    expect(V3StudentTestReadSchema.parse({
      testId: "shared-job-1",
      title: "Mechanics",
      kind: "main",
      durationMinutes: 180,
      sectionCount: 3,
      window: { open: 1_787_808_000, close: null },
    }).sectionCount).toBe(3);

    const review = V3StudentTestReviewSchema.parse({
      testId: "shared-job-1",
      available: true,
      locked: false,
      score: 42,
      maxScore: 100,
      solutionsHidden: "until the test closes",
    });
    expect(() => V3StudentTestReviewSchema.parse({ ...review, review: [{ correctAnswer: 2 }] })).toThrow();
  });
});
