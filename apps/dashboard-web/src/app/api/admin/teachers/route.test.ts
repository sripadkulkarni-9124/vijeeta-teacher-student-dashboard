import { describe, expect, it, vi } from "vitest";

import type { DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { AdminRepository, ProfileRepository } from "../../../../server/dashboard-store";
import { createApproveTeacherRouteHandler } from "./[uid]/approve/route";
import { createSuspendTeacherRouteHandler } from "./[uid]/suspend/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const adminPrincipal: VerifiedPrincipal = {
  uid: "admin-uid", email: "admin@example.test", emailVerified: true, displayName: "Admin", authTime: NOW,
};
const adminProfile: DashboardProfileV2 = {
  internalProfileId: "profile-admin", firebaseUid: "admin-uid", verifiedEmail: "admin@example.test", displayName: "Admin",
  roles: { admin: "active" }, activeRole: "admin", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
};
const pendingTeacher: DashboardProfileV2 = {
  ...adminProfile,
  internalProfileId: "profile-teacher",
  firebaseUid: "teacher-uid",
  verifiedEmail: "teacher@example.test",
  roles: { teacher: "pending" },
  activeRole: null,
};
const activeTeacher: DashboardProfileV2 = {
  ...pendingTeacher,
  roles: { teacher: "active" },
  activeRole: "teacher",
};
const nonAdminProfile: DashboardProfileV2 = {
  ...activeTeacher,
  internalProfileId: "profile-non-admin",
  firebaseUid: "admin-uid",
  verifiedEmail: "admin@example.test",
};

function dependencies(actor: DashboardProfileV2 | null = adminProfile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const admin: AdminRepository = {
    listProfiles: vi.fn(),
    approveTeacher: vi.fn(async () => activeTeacher),
    suspendTeacher: vi.fn(async (): Promise<DashboardProfileV2> => ({
      ...activeTeacher,
      roles: { teacher: "suspended" },
      activeRole: null,
    })),
  };
  const common = {
    verifier: { verify: vi.fn(async () => adminPrincipal) },
    profiles,
    admin,
    now: () => NOW,
    createCorrelationId: () => CORRELATION_ID,
  };
  return {
    admin,
    approve: createApproveTeacherRouteHandler(common),
    suspend: createSuspendTeacherRouteHandler(common),
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/admin/teachers/teacher-uid/action", {
    method: "POST",
    headers: { authorization: "Bearer verified-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ uid: "teacher-uid" }) };

describe("Admin Teacher lifecycle routes", () => {
  it("approves and suspends the server-resolved Teacher with audited reasons", async () => {
    const { admin, approve, suspend } = dependencies();

    const approved = await approve(request({ reason: "Identity reviewed" }), context);
    const suspended = await suspend(request({ reason: "Policy violation reviewed" }), context);

    expect(approved.status).toBe(200);
    expect(suspended.status).toBe(200);
    expect(admin.approveTeacher).toHaveBeenCalledWith(adminPrincipal, "teacher-uid", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Identity reviewed",
    });
    expect(admin.suspendTeacher).toHaveBeenCalledWith(adminPrincipal, "teacher-uid", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Policy violation reviewed",
    });
  });

  it("rejects forged identity/role fields and empty suspension reasons", async () => {
    const { admin, approve, suspend } = dependencies();

    expect((await approve(request({ reason: "Reviewed", uid: "forged", role: "admin" }), context)).status).toBe(400);
    expect((await suspend(request({ reason: "   " }), context)).status).toBe(400);
    expect(admin.approveTeacher).not.toHaveBeenCalled();
    expect(admin.suspendTeacher).not.toHaveBeenCalled();
  });

  it("denies a non-Admin before resolving or mutating the target", async () => {
    const { admin, approve } = dependencies(nonAdminProfile);
    const response = await approve(request({ reason: "Forged approval" }), context);

    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden" } },
    });
    expect(admin.approveTeacher).not.toHaveBeenCalled();
  });

  it("maps an atomic audit/store failure to a safe retryable response", async () => {
    const { approve, admin } = dependencies();
    vi.mocked(admin.approveTeacher).mockRejectedValueOnce(new Error("audit mirror password=raw-secret failed"));

    const response = await approve(request({ reason: "Identity reviewed" }), context);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain(CORRELATION_ID);
    expect(serialized).not.toContain("raw-secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
