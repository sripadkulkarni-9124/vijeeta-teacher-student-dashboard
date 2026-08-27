import { describe, expect, it, vi } from "vitest";

import type { Classroom, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";
import type { PaginatedClassroomRepository, ProfileRepository } from "../../../server/dashboard-store";
import { createClassesRouteHandlers } from "./route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = { uid: "teacher-uid", email: "teacher@example.test", emailVerified: true, displayName: "Teacher", authTime: NOW };
const profile: DashboardProfileV2 = { internalProfileId: "profile-teacher", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: "Teacher", roles: { teacher: "active" }, activeRole: "teacher", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };
const classroom: Classroom = { id: "class-1", ownerUid: principal.uid, name: "Physics A", status: "active", createdAt: NOW, updatedAt: NOW };

function dependencies(actor = profile) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => actor) };
  const classrooms: PaginatedClassroomRepository = {
    create: vi.fn(async () => classroom),
    getClassroom: vi.fn(async () => classroom),
    listForPrincipal: vi.fn(async () => [classroom]),
    listForPrincipalPage: vi.fn(async () => ({ items: [classroom], nextCursor: null })),
    archive: vi.fn(async () => classroom),
    restore: vi.fn(async () => classroom),
  };
  return { classrooms, handlers: createClassesRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles, classrooms, now: () => NOW, createCorrelationId: () => CORRELATION_ID }) };
}

describe("classroom collection route", () => {
  it("creates an owned classroom for an active Teacher and rejects forged authority fields", async () => {
    const { handlers, classrooms } = dependencies();
    const valid = await handlers.POST(new Request("http://localhost/api/classes", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ name: "Physics A" }) }));
    expect(valid.status).toBe(201);
    expect(classrooms.create).toHaveBeenCalledWith(principal, { name: "Physics A" }, { now: NOW, correlationId: CORRELATION_ID });

    const forged = await handlers.POST(new Request("http://localhost/api/classes", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ name: "Physics A", ownerUid: "attacker", role: "admin" }) }));
    expect(forged.status).toBe(400);
    expect(classrooms.create).toHaveBeenCalledTimes(1);
  });

  it("paginates only the caller's active role scope and denies pending Teachers", async () => {
    const { handlers, classrooms } = dependencies();
    const listed = await handlers.GET(new Request("http://localhost/api/classes?limit=1", { headers: { authorization: "Bearer token" } }));
    expect(listed.status).toBe(200);
    expect(classrooms.listForPrincipalPage).toHaveBeenCalledWith(principal, { limit: 1 });

    const pending = { ...profile, roles: { teacher: "pending" as const }, activeRole: null };
    const denied = await dependencies(pending).handlers.POST(new Request("http://localhost/api/classes", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ name: "Denied" }) }));
    expect(denied.status).toBe(403);
  });
});
