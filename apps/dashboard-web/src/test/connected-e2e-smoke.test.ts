/**
 * Integrated three-role flow against loopback Auth and Firestore emulators.
 *
 * Skipped unless the emulators are running, so ordinary `pnpm test` is
 * unaffected. Run it with:
 *
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   pnpm --filter @vijeeta/dashboard-web exec vitest run src/test/connected-e2e-smoke.test.ts
 */
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import type { AdminBootstrapConfig } from "@vijeeta/api-contracts";

import { createAdminProfilesRouteHandlers } from "@/app/api/admin/profiles/route";
import { createClassesRouteHandlers } from "@/app/api/classes/route";
import { createClassroomMembersRouteHandlers } from "@/app/api/classes/[id]/members/route";
import { createAcceptInvitationRouteHandler } from "@/app/api/invitations/accept/route";
import { createProfileRouteHandlers } from "@/app/api/profile/route";
import {
  bearer,
  buildGateRuntime,
  createIdentity,
  emulatorsConfigured,
  GATE_ADMIN_EMAIL,
  request,
  resetEmulators,
  routeContext,
  type GateIdentity,
  type GateRuntime,
} from "./local-role-gate";

const ADMIN_EMAIL = GATE_ADMIN_EMAIL;
const bootstrap: AdminBootstrapConfig = { version: 1, verifiedEmails: [ADMIN_EMAIL], firebaseUids: [] };

const gate = emulatorsConfigured() ? describe : describe.skip;

async function body(response: Response): Promise<Record<string, never>> {
  return await response.json() as Record<string, never>;
}

gate("connected dashboard release gate", () => {
  let runtime: GateRuntime;
  let admin: GateIdentity;
  let teacher: GateIdentity;
  let student: GateIdentity;
  let outsider: GateIdentity;

  beforeAll(async () => {
    await resetEmulators();
    runtime = await buildGateRuntime();
    admin = await createIdentity(ADMIN_EMAIL);
    teacher = await createIdentity("gate-teacher@example.test");
    student = await createIdentity("gate-student@example.test");
    outsider = await createIdentity("gate-outsider@example.test");
  }, 60_000);

  const profileRoutes = () => createProfileRouteHandlers({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    adminBootstrap: bootstrap,
  });
  const classRoutes = () => createClassesRouteHandlers({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    classrooms: runtime.runtime.dashboard,
  });
  const memberRoutes = () => createClassroomMembersRouteHandlers({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    invitations: runtime.runtime.dashboard,
    coordinator: runtime.coordinator,
  });
  const acceptRoute = () => createAcceptInvitationRouteHandler({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    invitations: runtime.coordinator,
  });
  const adminProfileRoutes = () => createAdminProfilesRouteHandlers({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    admin: runtime.runtime.dashboard,
  });

  it("rejects an unauthenticated read", async () => {
    const response = await profileRoutes().GET(request("/api/profile"));
    expect(response.status).toBe(401);
  });

  it("bootstraps exactly the configured Admin identity", async () => {
    const response = await profileRoutes().GET(request("/api/profile", { headers: await bearer(admin) }));
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as { profile: { roles: Record<string, string>; firebaseUid: string } };
    expect(payload.profile.roles.admin).toBe("active");
    expect(payload.profile.firebaseUid).toBe(admin.uid);
  });

  it("does not bootstrap a non-configured identity", async () => {
    const response = await profileRoutes().GET(request("/api/profile", { headers: await bearer(outsider) }));
    expect(response.status).toBe(404);
  });

  it("onboards a Teacher as pending and denies class creation until approved", async () => {
    const onboarded = await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(teacher)), "content-type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    }));
    expect(onboarded.status).toBe(201);
    const payload = await body(onboarded) as unknown as { profile: { roles: Record<string, string> } };
    expect(payload.profile.roles.teacher).toBe("pending");

    const denied = await classRoutes().POST(request("/api/classes", {
      method: "POST",
      headers: { ...(await bearer(teacher)), "content-type": "application/json" },
      body: JSON.stringify({ name: "Grade 12 Physics" }),
    }));
    expect(denied.status).toBe(403);
  });

  it("lets the Admin approve the Teacher", async () => {
    const listed = await adminProfileRoutes().GET(request("/api/admin/profiles", { headers: await bearer(admin) }));
    expect(listed.status).toBe(200);

    const approved = await runtime.runtime.dashboard.approveTeacher(
      await runtime.runtime.verifier.verify(`Bearer ${await admin.idToken()}`),
      teacher.uid,
      { now: new Date().toISOString(), correlationId: randomUUID(), reason: "Release gate approval" },
    );
    expect(approved.roles.teacher).toBe("active");
  });

  it("refuses Admin profile listing for a Teacher", async () => {
    const response = await adminProfileRoutes().GET(request("/api/admin/profiles", { headers: await bearer(teacher) }));
    expect(response.status).toBe(403);
  });

  let classroomId: string;

  it("creates a class once the Teacher is active", async () => {
    const created = await classRoutes().POST(request("/api/classes", {
      method: "POST",
      headers: { ...(await bearer(teacher)), "content-type": "application/json" },
      body: JSON.stringify({ name: "Grade 12 Physics" }),
    }));
    expect(created.status).toBe(201);
    const payload = await body(created) as unknown as { classroom: { id: string; ownerUid: string } };
    classroomId = payload.classroom.id;
    expect(payload.classroom.ownerUid).toBe(teacher.uid);
  });

  it("invites a student and captures the delivery without opening SMTP", async () => {
    const invited = await memberRoutes().POST(
      request(`/api/classes/${classroomId}/members`, {
        method: "POST",
        headers: { ...(await bearer(teacher)), "content-type": "application/json" },
        body: JSON.stringify({ email: student.email }),
      }),
      routeContext({ id: classroomId }),
    );
    expect(invited.status).toBe(201);
    const captures = runtime.captures();
    expect(captures).toHaveLength(1);
    expect(captures[0]!.recipientEmail).toBe(student.email);
    expect(captures[0]!.teacherEmail).toBe(teacher.email);
    expect(captures[0]!.invitationUrl).toMatch(/token=/);
  });

  it("refuses roster access to a teacher who does not own the class", async () => {
    const response = await memberRoutes().GET(
      request(`/api/classes/${classroomId}/members`, { headers: await bearer(outsider) }),
      routeContext({ id: classroomId }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("shows the pending invitation on the owning teacher's roster", async () => {
    const response = await memberRoutes().GET(
      request(`/api/classes/${classroomId}/members`, { headers: await bearer(teacher) }),
      routeContext({ id: classroomId }),
    );
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as { invitations: { status: string; maskedEmail: string }[] };
    expect(payload.invitations).toHaveLength(1);
    expect(payload.invitations[0]!.status).toBe("pending");
    expect(payload.invitations[0]!.maskedEmail).not.toBe(student.email);
  });

  it("refuses an invitation addressed to a different email", async () => {
    await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(outsider)), "content-type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    }));
    const token = new URL(runtime.captures()[0]!.invitationUrl).hash.replace(/^#/, "").replace("token=", "");
    const response = await acceptRoute()(request("/api/invitations/accept", {
      method: "POST",
      headers: { ...(await bearer(outsider)), "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }));
    expect([403, 404]).toContain(response.status);
  });

  it("lets the invited student accept and join the class", async () => {
    await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(student)), "content-type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    }));
    const token = new URL(runtime.captures()[0]!.invitationUrl).hash.replace(/^#/, "").replace("token=", "");
    const accepted = await acceptRoute()(request("/api/invitations/accept", {
      method: "POST",
      headers: { ...(await bearer(student)), "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }));
    expect(accepted.status).toBe(200);
    const payload = await body(accepted) as unknown as { membership: { classroomId: string; studentUid: string } };
    expect(payload.membership.classroomId).toBe(classroomId);
    expect(payload.membership.studentUid).toBe(student.uid);
  });

  it("shows the joined student on the teacher's roster as accepted", async () => {
    const response = await memberRoutes().GET(
      request(`/api/classes/${classroomId}/members`, { headers: await bearer(teacher) }),
      routeContext({ id: classroomId }),
    );
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as {
      members: { studentUid: string; status: string }[];
      invitations: { status: string }[];
    };
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0]!.studentUid).toBe(student.uid);
    expect(payload.invitations[0]!.status).toBe("accepted");
  });

  it("shows the joined class to the student and to nobody else", async () => {
    const mine = await classRoutes().GET(request("/api/classes", { headers: await bearer(student) }));
    expect(mine.status).toBe(200);
    const payload = await body(mine) as unknown as { classrooms: { id: string }[] };
    expect(payload.classrooms.map((entry) => entry.id)).toEqual([classroomId]);

    const theirs = await classRoutes().GET(request("/api/classes", { headers: await bearer(outsider) }));
    const otherPayload = await body(theirs) as unknown as { classrooms: unknown[] };
    expect(otherPayload.classrooms).toHaveLength(0);
  });

});
