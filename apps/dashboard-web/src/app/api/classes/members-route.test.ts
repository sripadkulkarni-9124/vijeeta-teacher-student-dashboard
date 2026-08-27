import { describe, expect, it, vi } from "vitest";

import type { ClassroomInvite, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";
import type { InvitationRepository, ProfileRepository } from "../../../server/dashboard-store";
import { createClassroomMembersRouteHandlers } from "./[id]/members/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = { uid: "teacher-uid", email: "teacher@example.test", emailVerified: true, displayName: "Teacher", authTime: NOW };
const profile: DashboardProfileV2 = { internalProfileId: "profile-teacher", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: "Teacher", roles: { teacher: "active" }, activeRole: "teacher", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };
const invite: ClassroomInvite = { id: "invite-1", classroomId: "class-1", ownerUid: principal.uid, normalizedEmail: "student@example.test", tokenDigest: "d".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z", status: "pending", delivery: "sent", acceptedUid: null, acceptedAt: null, createdAt: NOW, updatedAt: NOW };

function dependencies(actor = profile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const invitations = {
    listRoster: vi.fn(async () => ({ members: [], invitations: [], nextMemberCursor: null, nextInvitationCursor: null })),
  } as unknown as InvitationRepository;
  const coordinator = { invite: vi.fn(async () => invite) };
  const handlers = createClassroomMembersRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles, invitations, coordinator, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
  return { handlers, invitations, coordinator };
}

const routeContext = { params: Promise.resolve({ id: "class-1" }) };

describe("classroom roster and invitation route", () => {
  it("lists a bounded redacted owner roster and sends an invitation through the coordinator", async () => {
    const { handlers, invitations, coordinator } = dependencies();
    const listed = await handlers.GET(new Request("http://localhost/api/classes/class-1/members?limit=25", { headers: { authorization: "Bearer token" } }), routeContext);
    expect(listed.status).toBe(200);
    expect(invitations.listRoster).toHaveBeenCalledWith(principal, "class-1", { limit: 25 });

    const sent = await handlers.POST(new Request("http://localhost/api/classes/class-1/members", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ email: "student@example.test" }) }), routeContext);
    expect(sent.status).toBe(201);
    expect(coordinator.invite).toHaveBeenCalledWith(principal, "class-1", "student@example.test", { now: NOW, correlationId: CORRELATION_ID });
    expect(JSON.stringify(await sent.json())).not.toContain("d".repeat(64));
  });

  it("denies cross-role callers before roster or email orchestration", async () => {
    const student = { ...profile, roles: { student: "active" as const }, activeRole: "student" as const };
    const { handlers, invitations, coordinator } = dependencies(student);
    expect((await handlers.GET(new Request("http://localhost/api/classes/class-1/members", { headers: { authorization: "Bearer token" } }), routeContext)).status).toBe(403);
    expect(invitations.listRoster).not.toHaveBeenCalled();
    expect(coordinator.invite).not.toHaveBeenCalled();
  });
});
