import { describe, expect, it } from "vitest";
import {
  DashboardProfileSchema,
  ProfileOnboardRequestSchema,
  parseV3ReadRoute,
  V3_READ_PATHS,
} from "./v3-dashboard";

describe("V3 dashboard BFF contracts", () => {
  it("keeps the supported reads explicit and excludes mutating/share collection paths", () => {
    expect(V3_READ_PATHS).toEqual(expect.arrayContaining([
      "/v3/shared/mode",
      "/v3/shared/tests",
      "/v3/test/{id}",
      "/v3/test/{id}/review",
      "/v3/test/{id}/analysis",
      "/v3/analysis/tests",
      "/v3/analysis/overall",
      "/v3/analysis/pyq",
      "/v3/paperdesk/config",
      "/v3/paperdesk/jobs",
      "/v3/paperdesk/jobs/{id}",
    ]));
    expect(V3_READ_PATHS).not.toContain("/v3/paperdesk/shares");
    expect(V3_READ_PATHS).not.toContain("/v3/shared-web/enter/{token}");
    expect(V3_READ_PATHS).not.toContain("/v3/shared-web/resolve/{token}");
    expect(V3_READ_PATHS).not.toContain("/v3/paperdesk/shares/{sid}/results");
    expect(V3_READ_PATHS).not.toContain("/v3/paperdesk/shares/{sid}/student/{uid}/analysis");
    expect(() => parseV3ReadRoute(["shared-web", "enter", "opaque-token"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["shared-web", "resolve", "opaque-token"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "shares", "sid", "results"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "shares", "sid", "student", "uid", "analysis"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "jobs", "x", "submit"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "shares"], new URLSearchParams())).toThrow();
  });

  it("validates required and bounded V3 query parameters", () => {
    expect(parseV3ReadRoute(["analysis", "overall"], new URLSearchParams("user_id=uid-1")).path).toBe("/v3/analysis/overall");
    expect(() => parseV3ReadRoute(["analysis", "overall"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "jobs"], new URLSearchParams("page=0"))).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "jobs"], new URLSearchParams("unknown=x"))).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "jobs"], new URLSearchParams("key=legacy-admin-key"))).toThrow();
  });

  it("binds profile roles to the verified identity and accepts only exact onboarding roles", () => {
    const profile = DashboardProfileSchema.parse({
      internalProfileId: "profile-1",
      firebaseUid: "firebase-1",
      allowedRoles: ["teacher"],
      activeRole: "teacher",
      onboardingCompleted: true,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(profile.firebaseUid).toBe("firebase-1");
    expect(ProfileOnboardRequestSchema.parse({ role: "student" }).role).toBe("student");
    expect(() => ProfileOnboardRequestSchema.parse({ role: "teacher", firebaseUid: "forged" })).toThrow();
  });
});
