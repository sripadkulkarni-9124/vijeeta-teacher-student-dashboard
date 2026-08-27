import { describe, expect, it, vi } from "vitest";

import type { AuditEvent, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AuditRepository, ProfileRepository } from "../../../../server/dashboard-store";
import { createAdminAuditRouteHandlers } from "./route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = {
  uid: "admin-uid", email: "admin@example.test", emailVerified: true, displayName: "Admin", authTime: NOW,
};
const profile: DashboardProfileV2 = {
  internalProfileId: "profile-admin", firebaseUid: "admin-uid", verifiedEmail: "admin@example.test", displayName: "Admin",
  roles: { admin: "active" }, activeRole: "admin", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
};
const event: AuditEvent = {
  id: "audit-1", actorUid: "admin-uid", actorProfileId: "profile-admin", action: "teacher.approved",
  targetType: "profile", targetId: "teacher-uid", reason: "Identity reviewed", correlationId: CORRELATION_ID,
  canonicalLogInsertId: "audit-1", createdAt: NOW,
};

describe("Admin audit route", () => {
  it("returns only the bounded canonical audit projection to persisted Admin", async () => {
    const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => profile) };
    const audit: AuditRepository = { listAuditEvents: vi.fn(async () => ({ items: [event], nextCursor: null })) };
    const { GET } = createAdminAuditRouteHandlers({
      verifier: { verify: vi.fn(async () => principal) }, profiles, audit,
      createCorrelationId: () => CORRELATION_ID,
    });

    const response = await GET(new Request("http://localhost/api/admin/audit?limit=5", {
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [event], nextCursor: null });
    expect(audit.listAuditEvents).toHaveBeenCalledWith(principal, { limit: 5 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
