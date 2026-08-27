import { describe, expect, it, vi } from "vitest";

import type { DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AdminRepository, ProfileRepository } from "../../../../server/dashboard-store";
import { createAdminProfilesRouteHandlers } from "./route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = {
  uid: "admin-uid", email: "admin@example.test", emailVerified: true, displayName: "Admin", authTime: NOW,
};
const adminProfile: DashboardProfileV2 = {
  internalProfileId: "profile-admin", firebaseUid: "admin-uid", verifiedEmail: "admin@example.test", displayName: "Admin",
  roles: { admin: "active" }, activeRole: "admin", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
};
const teacherProfile: DashboardProfileV2 = {
  ...adminProfile,
  internalProfileId: "profile-teacher",
  firebaseUid: "teacher-uid",
  verifiedEmail: "teacher@example.test",
  roles: { teacher: "pending" },
  activeRole: null,
};
const nonAdminProfile: DashboardProfileV2 = {
  ...teacherProfile,
  internalProfileId: "profile-non-admin",
  firebaseUid: "admin-uid",
  verifiedEmail: "admin@example.test",
};

function dependencies(options: { actor?: DashboardProfileV2 | null } = {}) {
  const profiles: Pick<ProfileRepository, "getProfile"> = {
    getProfile: vi.fn(async () => options.actor === undefined ? adminProfile : options.actor),
  };
  const admin: AdminRepository = {
    listProfiles: vi.fn(async () => ({ items: [teacherProfile], nextCursor: "next-page" })),
    approveTeacher: vi.fn(),
    suspendTeacher: vi.fn(),
  };
  return {
    profiles,
    admin,
    handlers: createAdminProfilesRouteHandlers({
      verifier: { verify: vi.fn(async () => principal) },
      profiles,
      admin,
      createCorrelationId: () => CORRELATION_ID,
    }),
  };
}

function request(query = ""): Request {
  return new Request(`http://localhost/api/admin/profiles${query}`, {
    headers: { authorization: "Bearer verified-token" },
  });
}

describe("Admin profile list route", () => {
  it("requires persisted active Admin and forwards only bounded pagination", async () => {
    const { handlers: { GET }, admin } = dependencies();
    const response = await GET(request("?limit=2"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profiles: [teacherProfile], nextCursor: "next-page" });
    expect(admin.listProfiles).toHaveBeenCalledWith(principal, { limit: 2 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("denies a non-Admin before the Admin repository is queried", async () => {
    const { handlers: { GET }, admin } = dependencies({ actor: nonAdminProfile });
    const response = await GET(request());

    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden" } },
    });
    expect(admin.listProfiles).not.toHaveBeenCalled();
  });

  it("rejects client identity filters instead of treating them as authority", async () => {
    const { handlers: { GET }, admin } = dependencies();
    const response = await GET(request("?uid=forged&role=admin"));

    expect(response.status).toBe(400);
    expect(admin.listProfiles).not.toHaveBeenCalled();
  });
});
