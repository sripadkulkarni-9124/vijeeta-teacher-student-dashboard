import { describe, expect, it, vi } from "vitest";

import type { ClassroomInvite, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import {
  DashboardStoreError,
  type AdminInvitationRepository,
  type ProfileRepository,
} from "../../../../server/dashboard-store";
import { createAdminInvitationsRouteHandlers } from "./route";
import { createRevokeInvitationRouteHandler } from "./[id]/revoke/route";
import { createRedeliverInvitationRouteHandler } from "./[id]/redeliver/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = {
  uid: "admin-uid", email: "admin@example.test", emailVerified: true, displayName: "Admin", authTime: NOW,
};
const adminProfile: DashboardProfileV2 = {
  internalProfileId: "profile-admin", firebaseUid: "admin-uid", verifiedEmail: "admin@example.test", displayName: "Admin",
  roles: { admin: "active" }, activeRole: "admin", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
};
const invite: ClassroomInvite = {
  id: "invite-1", classroomId: "class-1", ownerUid: "teacher-uid", normalizedEmail: "student@example.test",
  tokenDigest: "d".repeat(64), tokenVersion: 1, expiresAt: "2026-09-04T08:00:00.000Z",
  status: "pending", delivery: "failed", deliveryErrorCategory: "retryable", acceptedUid: null, acceptedAt: null,
  createdAt: NOW, updatedAt: NOW,
};

function dependencies(actor: DashboardProfileV2 = adminProfile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const invitations: AdminInvitationRepository = {
    listInvitations: vi.fn(async () => ({ items: [invite], nextCursor: "next-invitations" })),
    getInvitationById: vi.fn(async () => invite),
    revokeInvitationById: vi.fn(async (): Promise<ClassroomInvite> => ({ ...invite, status: "revoked", updatedAt: NOW })),
    requestInvitationRedelivery: vi.fn(async (): Promise<ClassroomInvite> => ({
      ...invite, delivery: "redelivery_requested", deliveryErrorCategory: null, updatedAt: NOW,
    })),
  };
  const common = {
    verifier: { verify: vi.fn(async () => principal) }, profiles, invitations,
    now: () => NOW, createCorrelationId: () => CORRELATION_ID,
  };
  return {
    invitations,
    list: createAdminInvitationsRouteHandlers(common),
    revoke: createRevokeInvitationRouteHandler(common),
    redeliver: createRedeliverInvitationRouteHandler(common),
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/invitations/invite-1/action", {
    method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "invite-1" }) };

describe("Admin invitation routes", () => {
  it("lists a bounded safe projection without email, digest, or raw token", async () => {
    const { list: { GET }, invitations } = dependencies();
    const response = await GET(new Request("http://localhost/api/admin/invitations?limit=25", {
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    expect(invitations.listInvitations).toHaveBeenCalledWith(principal, { limit: 25 });
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ invitations: [{ id: "invite-1", delivery: "failed" }], nextCursor: "next-invitations" });
    expect(JSON.stringify(body)).not.toContain("student@example.test");
    expect(JSON.stringify(body)).not.toContain("d".repeat(64));
  });

  it("revokes and requests redelivery by server-resolved invitation ID with reasons", async () => {
    const { revoke, redeliver, invitations } = dependencies();
    const revoked = await revoke(post({ reason: "Invite withdrawn" }), context);
    const requested = await redeliver(post({ reason: "Recipient requested a new link" }), context);

    expect(revoked.status).toBe(200);
    expect(requested.status).toBe(202);
    expect(invitations.revokeInvitationById).toHaveBeenCalledWith(principal, "invite-1", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Invite withdrawn",
    });
    expect(invitations.requestInvitationRedelivery).toHaveBeenCalledWith(principal, "invite-1", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Recipient requested a new link",
    });
    expect(await requested.json()).toMatchObject({ invite: { id: "invite-1", delivery: "redelivery_requested", tokenVersion: 1 } });
  });

  it("rejects empty reasons and unknown invitation IDs with stable errors", async () => {
    const { revoke, invitations } = dependencies();
    expect((await revoke(post({ reason: "" }), context)).status).toBe(400);
    expect(invitations.revokeInvitationById).not.toHaveBeenCalled();

    vi.mocked(invitations.revokeInvitationById).mockRejectedValueOnce(
      new DashboardStoreError("internal lookup detail", "invitation_not_found"),
    );
    const missing = await revoke(post({ reason: "Withdraw" }), context);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "invitation_not_found", message: "Invitation was not found" } });
  });

  it("returns a stable 400 for reserved route IDs before repository access", async () => {
    const { revoke, invitations } = dependencies();
    const response = await revoke(post({ reason: "Withdraw" }), {
      params: Promise.resolve({ id: "__name__" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(invitations.revokeInvitationById).not.toHaveBeenCalled();
  });

  it("denies non-Admin callers before invitation lookup or mutation", async () => {
    const teacher = { ...adminProfile, roles: { teacher: "active" as const }, activeRole: "teacher" as const };
    const { revoke, invitations } = dependencies(teacher);
    expect((await revoke(post({ reason: "Forged revoke" }), context)).status).toBe(403);
    expect(invitations.revokeInvitationById).not.toHaveBeenCalled();
    expect(invitations.getInvitationById).not.toHaveBeenCalled();
  });
});
