import { describe, expect, it, vi } from "vitest";

import {
  ProductionApiError,
  createProductionApi,
  type ProductionAuthSession,
} from "./production-api";

function authSession(): ProductionAuthSession {
  return {
    currentUser: {
      uid: "uid-1",
      email: "aarav@example.test",
      displayName: "Aarav Kulkarni",
    },
    getIdToken: vi
      .fn<ProductionAuthSession["getIdToken"]>()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2")
      .mockResolvedValueOnce("token-3")
      .mockResolvedValueOnce("token-4")
      .mockResolvedValueOnce("token-5"),
    signInWithEmailPassword: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe("production API client", () => {
  it("refreshes the in-memory ID token before each student read", async () => {
    const auth = authSession();
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ path: String(input) }), {
        headers: { "content-type": "application/json" },
        ...init,
      });
    });
    const api = createProductionApi({ auth, transport });

    await api.readStudent();

    expect(auth.getIdToken).toHaveBeenCalledTimes(5);
    expect(transport).toHaveBeenNthCalledWith(1, "/api/v3/shared/mode", {
      headers: { authorization: "Bearer token-1" },
    });
    expect(transport).toHaveBeenNthCalledWith(2, "/api/v3/shared/tests", {
      headers: { authorization: "Bearer token-2" },
    });
    expect(transport).toHaveBeenNthCalledWith(3, "/api/v3/analysis/tests?user_id=uid-1", {
      headers: { authorization: "Bearer token-3" },
    });
    expect(transport).toHaveBeenNthCalledWith(4, "/api/v3/analysis/overall?user_id=uid-1", {
      headers: { authorization: "Bearer token-4" },
    });
    expect(transport).toHaveBeenNthCalledWith(5, "/api/v3/analysis/pyq?user_id=uid-1", {
      headers: { authorization: "Bearer token-5" },
    });
  });

  it("loads profile and posts a server-authoritative onboarding role", async () => {
    const auth = authSession();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeRole: null,
            allowedRoles: ["student", "teacher"],
            onboardingComplete: false,
            user: auth.currentUser,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeRole: "student",
            allowedRoles: ["student"],
            onboardingComplete: true,
            user: auth.currentUser,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const api = createProductionApi({ auth, transport });

    await expect(api.getProfile()).resolves.toMatchObject({ onboardingComplete: false });
    await expect(api.onboard("student")).resolves.toMatchObject({ activeRole: "student" });
    expect(transport).toHaveBeenNthCalledWith(2, "/api/profile", {
      body: JSON.stringify({ role: "student" }),
      headers: {
        authorization: "Bearer token-2",
        "content-type": "application/json",
      },
      method: "POST",
    });
  });

  it("accepts the canonical V2 profile envelope and exposes active production roles only", async () => {
    const auth = authSession();
    const api = createProductionApi({
      auth,
      transport: vi.fn(async () => new Response(JSON.stringify({
        profile: {
          internalProfileId: "profile-uid-1",
          firebaseUid: "uid-1",
          verifiedEmail: "aarav@example.test",
          displayName: "Aarav Kulkarni",
          roles: { student: "active", teacher: "pending", admin: "active" },
          activeRole: "student",
          onboardingCompleted: true,
          schemaVersion: 2,
          createdAt: "2026-08-28T08:00:00.000Z",
          updatedAt: "2026-08-28T08:00:00.000Z",
        },
      }), { status: 200 })),
    });

    await expect(api.getProfile()).resolves.toEqual({
      user: auth.currentUser,
      activeRole: "student",
      allowedRoles: ["student"],
      onboardingComplete: true,
    });
  });

  it("rejects unknown canonical profile fields instead of accepting client-authored roles", async () => {
    const auth = authSession();
    const api = createProductionApi({
      auth,
      transport: vi.fn(async () => new Response(JSON.stringify({
        profile: {
          internalProfileId: "profile-uid-1",
          firebaseUid: "uid-1",
          verifiedEmail: "aarav@example.test",
          displayName: "Aarav Kulkarni",
          roles: { student: "active" },
          activeRole: "student",
          onboardingCompleted: true,
          schemaVersion: 2,
          createdAt: "2026-08-28T08:00:00.000Z",
          updatedAt: "2026-08-28T08:00:00.000Z",
          allowedRoles: ["teacher"],
        },
      }), { status: 200 })),
    });

    await expect(api.getProfile()).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("surfaces unauthorized and malformed production responses", async () => {
    const auth = authSession();
    const unauthorized = createProductionApi({
      auth,
      transport: vi.fn(async () => new Response("", { status: 403 })),
    });
    await expect(unauthorized.getProfile()).rejects.toMatchObject({
      kind: "unauthorized",
      status: 403,
    } satisfies Partial<ProductionApiError>);

    const malformed = createProductionApi({
      auth,
      transport: vi.fn(async () =>
        new Response(JSON.stringify({ nope: true }), { status: 200 }),
      ),
    });
    await expect(malformed.getProfile()).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
