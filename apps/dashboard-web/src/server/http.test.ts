import { describe, expect, it, vi } from "vitest";

import { AdminReasonRequestSchema, type DashboardProfileV2, type VerifiedPrincipal } from "@vijeeta/api-contracts";

import { TokenVerificationError } from "./profile-store";
import {
  HttpError,
  authenticateRequest,
  parseJsonBody,
  parsePagination,
  requireNoQuery,
  requireRole,
  serveHttp,
} from "./http";

const NOW = "2026-08-28T08:00:00.000Z";
const AUTH_TIME = "2026-08-28T07:55:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const verified: VerifiedPrincipal = {
  uid: "admin-uid",
  email: "admin@example.test",
  emailVerified: true,
  displayName: "Admin",
  authTime: AUTH_TIME,
};
const adminProfile: DashboardProfileV2 = {
  internalProfileId: "profile-admin",
  firebaseUid: "admin-uid",
  verifiedEmail: "admin@example.test",
  displayName: "Admin",
  roles: { admin: "active" },
  activeRole: "admin",
  onboardingCompleted: true,
  schemaVersion: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("HTTP authentication and authorization", () => {
  it("accepts only a verified Bearer principal and rejects forged verifier fields", async () => {
    const request = new Request("http://localhost/api/admin/profiles", {
      headers: { authorization: "Bearer signed-token" },
    });
    await expect(authenticateRequest(request, { verify: async () => verified })).resolves.toEqual(verified);
    await expect(authenticateRequest(request, {
      verify: async () => ({ ...verified, role: "admin" }) as VerifiedPrincipal,
    })).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("maps invalid and unavailable verification without exposing verifier details", async () => {
    const request = new Request("http://localhost/api/profile", {
      headers: { authorization: "Bearer token" },
    });
    await expect(authenticateRequest(request, {
      verify: async () => { throw new TokenVerificationError("raw firebase rejection", 401); },
    })).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    await expect(authenticateRequest(request, {
      verify: async () => { throw new TokenVerificationError("credential path", 503); },
    })).rejects.toMatchObject({ status: 503, code: "authentication_unavailable" });
  });

  it("resolves an active role from the persisted profile for the verified UID", async () => {
    const getProfile = vi.fn(async () => adminProfile);
    await expect(requireRole(verified, "admin", { getProfile })).resolves.toEqual(adminProfile);
    expect(getProfile).toHaveBeenCalledWith("admin-uid");

    await expect(requireRole(verified, "teacher", { getProfile })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("bounded request parsing", () => {
  it("strictly parses JSON and rejects unknown keys", async () => {
    const valid = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Identity reviewed" }),
    });
    await expect(parseJsonBody(valid, AdminReasonRequestSchema)).resolves.toEqual({ reason: "Identity reviewed" });

    const forged = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Identity reviewed", uid: "forged" }),
    });
    await expect(parseJsonBody(forged, AdminReasonRequestSchema)).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
  });

  it("rejects oversized JSON before schema validation", async () => {
    const oversized = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "x".repeat(200) }),
    });
    await expect(parseJsonBody(oversized, AdminReasonRequestSchema, { maximumBytes: 64 })).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
  });

  it("allows only one bounded cursor and integer limit", () => {
    expect(parsePagination(new Request("http://localhost/api/admin/profiles?limit=2"))).toEqual({ limit: 2 });
    expect(() => parsePagination(new Request("http://localhost/api/admin/profiles?limit=2&limit=3"))).toThrow(HttpError);
    expect(() => parsePagination(new Request("http://localhost/api/admin/profiles?uid=forged"))).toThrow(HttpError);
    expect(() => parsePagination(new Request("http://localhost/api/admin/profiles?limit=101"))).toThrow(HttpError);
  });

  it("rejects query keys on routes without a query contract", () => {
    expect(() => requireNoQuery(new Request("http://localhost/api/profile"))).not.toThrow();
    expect(() => requireNoQuery(new Request("http://localhost/api/profile?uid=forged"))).toThrow(HttpError);
  });
});

describe("safe HTTP errors", () => {
  it("returns stable no-store errors with a correlation ID and no raw failure details", async () => {
    const response = await serveHttp(
      new Request("http://localhost/api/admin/audit"),
      async () => { throw new Error("firestore password=raw-secret failed"); },
      { createCorrelationId: () => CORRELATION_ID },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "The dashboard service is temporarily unavailable",
        correlationId: CORRELATION_ID,
        retryable: true,
      },
    });
  });
});
