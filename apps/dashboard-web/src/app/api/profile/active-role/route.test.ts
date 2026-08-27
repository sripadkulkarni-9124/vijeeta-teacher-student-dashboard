import { describe, expect, it, vi } from "vitest";

import type { DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../../server/dashboard-store";
import { DashboardStoreError } from "../../../../server/dashboard-store";
import { createActiveRoleRouteHandler } from "./route";

const NOW = "2026-08-28T10:00:00.000Z";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000019";
const principal: VerifiedPrincipal = { uid: "uid-1", email: "user@example.test", emailVerified: true, displayName: "User", authTime: NOW };
const switched: DashboardProfileV2 = {
  internalProfileId: "profile-1", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: principal.displayName,
  roles: { student: "active", teacher: "active" }, activeRole: "teacher", onboardingCompleted: true, schemaVersion: 2,
  createdAt: NOW, updatedAt: NOW,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/profile/active-role", {
    method: "POST", headers: { authorization: "Bearer verified", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/profile/active-role", () => {
  it("derives identity from Firebase and switches only through the profile repository", async () => {
    const profiles = { setActiveRole: vi.fn(async () => switched) } as unknown as ProfileRepository;
    const handler = createActiveRoleRouteHandler({ verifier: { verify: vi.fn(async () => principal) }, profiles, now: () => NOW, createCorrelationId: () => CORRELATION_ID });

    const response = await handler(request({ activeRole: "teacher" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: switched });
    expect(profiles.setActiveRole).toHaveBeenCalledWith(principal, "teacher", { now: NOW, correlationId: CORRELATION_ID });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects client identity, role state, and unknown fields before persistence", async () => {
    const profiles = { setActiveRole: vi.fn() } as unknown as ProfileRepository;
    const handler = createActiveRoleRouteHandler({ verifier: { verify: vi.fn(async () => principal) }, profiles, now: () => NOW, createCorrelationId: () => CORRELATION_ID });

    const response = await handler(request({ activeRole: "admin", uid: "forged", roles: { admin: "active" } }));

    expect(response.status).toBe(400);
    expect(profiles.setActiveRole).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("forged");
  });

  it("fails a pending, suspended, or ungranted role closed as forbidden", async () => {
    const profiles = { setActiveRole: vi.fn(async () => { throw new DashboardStoreError("not active", "role_not_active"); }) } as unknown as ProfileRepository;
    const handler = createActiveRoleRouteHandler({ verifier: { verify: vi.fn(async () => principal) }, profiles, now: () => NOW, createCorrelationId: () => CORRELATION_ID });

    const response = await handler(request({ activeRole: "teacher" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
