import { describe, expect, it, vi } from "vitest";

import type { Classroom, ClassroomInvite, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";
import type { InvitationRepository, PaginatedClassroomRepository, ProfileRepository } from "../../../server/dashboard-store";
import { createTeacherArchiveClassroomRouteHandler } from "./[id]/archive/route";
import { createTeacherRedeliverInvitationRouteHandler } from "./[id]/invitations/[inviteId]/redeliver/route";
import { createTeacherRevokeInvitationRouteHandler } from "./[id]/invitations/[inviteId]/revoke/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = { uid: "teacher-uid", email: "teacher@example.test", emailVerified: true, displayName: "Teacher", authTime: NOW };
const profile: DashboardProfileV2 = { internalProfileId: "profile-teacher", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: "Teacher", roles: { teacher: "active" }, activeRole: "teacher", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };
const classroom: Classroom = { id: "class-1", ownerUid: principal.uid, name: "Physics A", status: "active", createdAt: NOW, updatedAt: NOW };
const invite: ClassroomInvite = { id: "invite-1", classroomId: classroom.id, ownerUid: principal.uid, normalizedEmail: "student@example.test", tokenDigest: "d".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z", status: "pending", delivery: "failed", deliveryErrorCategory: "retryable", acceptedUid: null, acceptedAt: null, createdAt: NOW, updatedAt: NOW };

function dependencies(actor = profile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const classrooms = { archive: vi.fn(async () => ({ ...classroom, status: "archived" as const })) } as unknown as PaginatedClassroomRepository;
  const invitations = { revokeInvitation: vi.fn(async () => ({ ...invite, status: "revoked" as const })) } as unknown as InvitationRepository;
  const coordinator = { redeliver: vi.fn(async () => ({ ...invite, tokenVersion: 2, delivery: "sent" as const, deliveryErrorCategory: null })) };
  const common = { verifier: { verify: vi.fn(async () => principal) }, profiles, now: () => NOW, createCorrelationId: () => CORRELATION_ID };
  return {
    classrooms, invitations, coordinator,
    archive: createTeacherArchiveClassroomRouteHandler({ ...common, classrooms }),
    revoke: createTeacherRevokeInvitationRouteHandler({ ...common, invitations }),
    redeliver: createTeacherRedeliverInvitationRouteHandler({ ...common, coordinator }),
  };
}

const classContext = { params: Promise.resolve({ id: "class-1" }) };
const inviteContext = { params: Promise.resolve({ id: "class-1", inviteId: "invite-1" }) };
function post(reason: string) { return new Request("http://localhost/api/classes/action", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ reason }) }); }

describe("Teacher classroom state actions", () => {
  it("archives, revokes, and explicitly redelivers owned state with audited reasons", async () => {
    const flow = dependencies();
    expect((await flow.archive(post("Term ended"), classContext)).status).toBe(200);
    expect((await flow.revoke(post("Recipient removed"), inviteContext)).status).toBe(200);
    expect((await flow.redeliver(post("Recipient requested a new link"), inviteContext)).status).toBe(200);
    expect(flow.classrooms.archive).toHaveBeenCalledWith(principal, "class-1", { now: NOW, correlationId: CORRELATION_ID, reason: "Term ended" });
    expect(flow.invitations.revokeInvitation).toHaveBeenCalledWith(principal, "class-1", "invite-1", { now: NOW, correlationId: CORRELATION_ID, reason: "Recipient removed" });
    expect(flow.coordinator.redeliver).toHaveBeenCalledTimes(1);
  });

  it("denies non-Teachers and rejects empty reasons before mutation", async () => {
    const student = { ...profile, roles: { student: "active" as const }, activeRole: "student" as const };
    const denied = dependencies(student);
    expect((await denied.archive(post("Forged"), classContext)).status).toBe(403);
    expect((await dependencies().revoke(post(""), inviteContext)).status).toBe(400);
    expect(denied.classrooms.archive).not.toHaveBeenCalled();
  });
});
