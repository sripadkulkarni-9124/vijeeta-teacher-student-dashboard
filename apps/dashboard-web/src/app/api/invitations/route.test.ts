import { describe, expect, it, vi } from "vitest";

import type { ClassroomMembership, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";
import { createAcceptInvitationRouteHandler } from "./accept/route";
import { createInspectInvitationRouteHandler } from "./inspect/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = { uid: "student-uid", email: "student@example.test", emailVerified: true, displayName: "Student", authTime: NOW };
const student: DashboardProfileV2 = { internalProfileId: "profile-student", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: "Student", roles: { student: "active" }, activeRole: "student", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };
const membership: ClassroomMembership = { classroomId: "class-1", studentUid: principal.uid, sourceInviteId: "invite-1", status: "active", joinedAt: NOW, updatedAt: NOW };

function dependencies(actor: DashboardProfileV2 | null = student) {
  const invitations = {
    inspect: vi.fn(async () => ({ inviteId: "invite-1", classroomId: "class-1", classroomName: "Physics A", teacherDisplayName: "Teacher", targetEmailMatches: true, studentOnboardingRequired: false, expiresAt: "2026-09-04T08:00:00.000Z", status: "pending" as const })),
    accept: vi.fn(async () => membership),
  };
  const common = { verifier: { verify: vi.fn(async () => principal) }, profiles: { getProfile: vi.fn(async () => actor) }, invitations, now: () => NOW, createCorrelationId: () => CORRELATION_ID };
  return { invitations, inspect: createInspectInvitationRouteHandler(common), accept: createAcceptInvitationRouteHandler(common) };
}

function post(token = "invite-1.abcdefghijklmnopqrstuvwxyzABCDEFGH123456789") {
  return new Request("http://localhost/api/invitations/action", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ token }) });
}

describe("invitation inspect and accept routes", () => {
  it("returns only redacted inspect metadata for a verified authenticated identity", async () => {
    const { inspect } = dependencies();
    const response = await inspect(post());
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("Physics A");
    expect(serialized).not.toContain("student@example.test");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("accepts only an explicit active Student and is safe for idempotent repository success", async () => {
    const { accept, invitations } = dependencies();
    expect((await accept(post())).status).toBe(200);
    expect((await accept(post())).status).toBe(200);
    expect(invitations.accept).toHaveBeenCalledTimes(2);

    const noStudent = { ...student, roles: { teacher: "active" as const }, activeRole: "teacher" as const };
    const denied = dependencies(noStudent);
    expect((await denied.accept(post())).status).toBe(403);
    expect(denied.invitations.accept).not.toHaveBeenCalled();
  });
});
