import { describe, expect, it, vi } from "vitest";

import type {
  AdminBootstrapConfig,
  DashboardProfileV2,
  VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../server/dashboard-store";
import { createProfileRouteHandlers } from "./route";

const NOW = "2026-08-28T08:00:00.000Z";
const AUTH_TIME = "2026-08-28T07:55:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const BOOTSTRAP: AdminBootstrapConfig = {
  version: 1,
  verifiedEmails: ["admin@example.test"],
  firebaseUids: [],
};

function principal(uid = "admin-uid", email = "admin@example.test"): VerifiedPrincipal {
  return { uid, email, emailVerified: true, displayName: "Verified User", authTime: AUTH_TIME };
}

function profile(
  uid: string,
  roles: DashboardProfileV2["roles"],
  activeRole: DashboardProfileV2["activeRole"],
): DashboardProfileV2 {
  return {
    internalProfileId: `profile-${uid}`,
    firebaseUid: uid,
    verifiedEmail: `${uid}@example.test`,
    displayName: "Verified User",
    roles,
    activeRole,
    onboardingCompleted: true,
    schemaVersion: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function repositories(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    getProfile: vi.fn(async () => null),
    onboard: vi.fn(async (verified, input) => profile(
      verified.uid,
      input.role === "teacher" ? { teacher: "pending" } : { student: "active" },
      input.role === "teacher" ? null : "student",
    )),
    bootstrapAdmin: vi.fn(async (verified) => profile(verified.uid, { admin: "active" }, "admin")),
    ...overrides,
  };
}

function handlers(options: {
  verified?: VerifiedPrincipal;
  profiles?: ProfileRepository;
  bootstrap?: AdminBootstrapConfig;
} = {}) {
  return createProfileRouteHandlers({
    verifier: { verify: vi.fn(async () => options.verified ?? principal()) },
    profiles: options.profiles ?? repositories(),
    adminBootstrap: options.bootstrap ?? BOOTSTRAP,
    now: () => NOW,
    createCorrelationId: () => CORRELATION_ID,
  });
}

function request(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/profile", {
    method,
    headers: {
      authorization: "Bearer verified-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("connected profile routes", () => {
  it("bootstraps Admin only from the exact verified server allowlist", async () => {
    const profiles = repositories();
    const { GET } = handlers({ profiles });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ profile: { firebaseUid: "admin-uid", roles: { admin: "active" } } });
    expect(profiles.bootstrapAdmin).toHaveBeenCalledWith(
      principal(),
      BOOTSTRAP,
      { now: NOW, correlationId: CORRELATION_ID },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not bootstrap a non-allowlisted authenticated profile", async () => {
    const existing = profile("student-uid", { student: "active" }, "student");
    const profiles = repositories({ getProfile: vi.fn(async () => existing) });
    const { GET } = handlers({ verified: principal("student-uid", "student@example.test"), profiles });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: existing });
    expect(profiles.bootstrapAdmin).not.toHaveBeenCalled();
  });

  it("keeps Teacher onboarding pending until an Admin approves it", async () => {
    const profiles = repositories();
    const { POST } = handlers({
      verified: principal("teacher-uid", "teacher@example.test"),
      profiles,
    });

    const response = await POST(request("POST", { role: "teacher" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      profile: { firebaseUid: "teacher-uid", roles: { teacher: "pending" }, activeRole: null },
    });
    expect(profiles.onboard).toHaveBeenCalledWith(
      principal("teacher-uid", "teacher@example.test"),
      { role: "teacher" },
      { now: NOW, correlationId: CORRELATION_ID },
    );
  });

  it("rejects client identity and Admin role assertions before persistence", async () => {
    const profiles = repositories();
    const { POST } = handlers({ profiles });

    const response = await POST(request("POST", {
      role: "admin",
      uid: "forged",
      email: "forged@example.test",
    }));

    expect(response.status).toBe(400);
    expect(profiles.onboard).not.toHaveBeenCalled();
    expect(profiles.bootstrapAdmin).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("forged@example.test");
  });

  it("returns a safe not-found error for a non-bootstrap identity without a profile", async () => {
    const { GET } = handlers({ verified: principal("new-uid", "new@example.test") });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "profile_not_found",
        message: "Profile onboarding is required",
        correlationId: CORRELATION_ID,
        retryable: false,
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
