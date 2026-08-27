import { describe, expect, it, vi } from "vitest";

import type { Classroom, DashboardProfileV2, VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { ClassroomRepository, ProfileRepository } from "../../../../server/dashboard-store";
import { createAdminClassroomsRouteHandlers } from "./route";
import { createArchiveClassroomRouteHandler } from "./[id]/archive/route";
import { createRestoreClassroomRouteHandler } from "./[id]/restore/route";

const NOW = "2026-08-28T08:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = {
  uid: "admin-uid", email: "admin@example.test", emailVerified: true, displayName: "Admin", authTime: NOW,
};
const adminProfile: DashboardProfileV2 = {
  internalProfileId: "profile-admin", firebaseUid: "admin-uid", verifiedEmail: "admin@example.test", displayName: "Admin",
  roles: { admin: "active" }, activeRole: "admin", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW,
};
const classroom: Classroom = {
  id: "class-1", ownerUid: "teacher-uid", name: "Class 12-A", status: "active", createdAt: NOW, updatedAt: NOW,
};
const olderClassroom: Classroom = {
  ...classroom,
  id: "class-2",
  name: "Class 11-B",
  createdAt: "2026-08-27T08:00:00.000Z",
  updatedAt: "2026-08-27T08:00:00.000Z",
};

function dependencies(items: Classroom[] = [classroom]) {
  const profiles: Pick<ProfileRepository, "getProfile"> = { getProfile: vi.fn(async () => adminProfile) };
  const classrooms: ClassroomRepository = {
    create: vi.fn(),
    getClassroom: vi.fn(async () => classroom),
    listForPrincipal: vi.fn(async () => items),
    archive: vi.fn(async (): Promise<Classroom> => ({ ...classroom, status: "archived" })),
    restore: vi.fn(async () => classroom),
  };
  const common = {
    verifier: { verify: vi.fn(async () => principal) }, profiles, classrooms,
    now: () => NOW, createCorrelationId: () => CORRELATION_ID,
  };
  return {
    classrooms,
    list: createAdminClassroomsRouteHandlers(common),
    archive: createArchiveClassroomRouteHandler(common),
    restore: createRestoreClassroomRouteHandler(common),
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/classrooms/class-1/action", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "class-1" }) };

describe("Admin classroom routes", () => {
  it("returns bounded class metadata without student answers or insights", async () => {
    const { list: { GET }, classrooms } = dependencies();
    const response = await GET(new Request("http://localhost/api/admin/classrooms?limit=1", {
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ classrooms: [classroom], nextCursor: null });
    expect(classrooms.listForPrincipal).toHaveBeenCalledWith(principal);
  });

  it("paginates the bounded classroom repository projection without overlap", async () => {
    const { list: { GET } } = dependencies([classroom, olderClassroom]);
    const first = await GET(new Request("http://localhost/api/admin/classrooms?limit=1", {
      headers: { authorization: "Bearer token" },
    }));
    const firstBody = await first.json() as { classrooms: Classroom[]; nextCursor: string | null };
    expect(firstBody.classrooms.map((item) => item.id)).toEqual(["class-1"]);
    expect(firstBody.nextCursor).not.toBeNull();
    if (firstBody.nextCursor === null) throw new Error("expected classroom cursor");

    const second = await GET(new Request(
      `http://localhost/api/admin/classrooms?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { headers: { authorization: "Bearer token" } },
    ));
    const secondBody = await second.json() as { classrooms: Classroom[]; nextCursor: string | null };
    expect(secondBody.classrooms.map((item) => item.id)).toEqual(["class-2"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("archives and restores a server-resolved classroom with non-empty reasons", async () => {
    const { archive, restore, classrooms } = dependencies();
    expect((await archive(post({ reason: "Course closed" }), context)).status).toBe(200);
    expect((await restore(post({ reason: "Course reopened" }), context)).status).toBe(200);
    expect(classrooms.archive).toHaveBeenCalledWith(principal, "class-1", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Course closed",
    });
    expect(classrooms.restore).toHaveBeenCalledWith(principal, "class-1", {
      now: NOW, correlationId: CORRELATION_ID, reason: "Course reopened",
    });
  });

  it("rejects an empty archive reason before the repository mutation", async () => {
    const { archive, classrooms } = dependencies();
    const response = await archive(post({ reason: "" }), context);
    expect(response.status).toBe(400);
    expect(classrooms.archive).not.toHaveBeenCalled();
  });
});
