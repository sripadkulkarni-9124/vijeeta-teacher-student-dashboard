import { describe, expect, it, vi } from "vitest";

import type { DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../../server/dashboard-store";
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

function dependencies(actor: DashboardProfileV2 = adminProfile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const common = {
    verifier: { verify: vi.fn(async () => principal) }, profiles,
    createCorrelationId: () => CORRELATION_ID,
  };
  return {
    list: createAdminInvitationsRouteHandlers(common),
    revoke: createRevokeInvitationRouteHandler(common),
    redeliver: createRedeliverInvitationRouteHandler(common),
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/invitations/invite-1/action", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "invite-1" }) };

describe("deferred Admin invitation contracts", () => {
  it("fails closed after Admin authorization when Task 6 listing is unavailable", async () => {
    const { list: { GET } } = dependencies();
    const response = await GET(new Request("http://localhost/api/admin/invitations", {
      headers: { authorization: "Bearer token" },
    }));
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { code: "not_implemented", retryable: false } });
  });

  it("requires reasons before deferring revoke and redelivery to Task 6", async () => {
    const { revoke, redeliver } = dependencies();
    expect((await revoke(post({ reason: "" }), context)).status).toBe(400);
    expect((await redeliver(post({ reason: "" }), context)).status).toBe(400);
    expect((await revoke(post({ reason: "Invite withdrawn" }), context)).status).toBe(501);
    expect((await redeliver(post({ reason: "Recipient requested a new link" }), context)).status).toBe(501);
  });

  it("denies non-Admin callers without revealing deferred route state", async () => {
    const teacher = { ...adminProfile, roles: { teacher: "active" as const }, activeRole: "teacher" as const };
    const { revoke } = dependencies(teacher);
    expect((await revoke(post({ reason: "Forged revoke" }), context)).status).toBe(403);
  });
});
