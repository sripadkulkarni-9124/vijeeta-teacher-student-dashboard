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
import { createAssignmentInsightsRouteHandler } from "@/app/api/assignments/[id]/insights/route";
import { createAssignmentLaunchRouteHandler } from "@/app/api/assignments/[id]/launch/route";
import { createStudentAssignmentInsightRouteHandler } from "@/app/api/assignments/[id]/students/[uid]/insights/route";
import { createClassroomAssignmentsRouteHandlers } from "@/app/api/classes/[id]/assignments/route";
import { createClassesRouteHandlers } from "@/app/api/classes/route";
import { createClassroomMembersRouteHandlers } from "@/app/api/classes/[id]/members/route";
import { createAcceptInvitationRouteHandler } from "@/app/api/invitations/accept/route";
import { createProfileRouteHandlers } from "@/app/api/profile/route";
import { V3AssignmentAdapter } from "@/server/v3-assignment-adapter";
import { V3InsightAdapter } from "@/server/v3-insight-adapter";
import {
  bearer,
  buildGateRuntime,
  createIdentity,
  emulatorsConfigured,
  GATE_ADMIN_EMAIL,
  gateEnvironment,
  request,
  resetEmulators,
  routeContext,
  strictV3Fetch,
  type GateIdentity,
  type GateRuntime,
} from "./local-role-gate";

const ADMIN_EMAIL = GATE_ADMIN_EMAIL;
const bootstrap: AdminBootstrapConfig = { version: 1, verifiedEmails: [ADMIN_EMAIL], firebaseUids: [] };

const gate = emulatorsConfigured() ? describe : describe.skip;

const V3_BASE_URL = new URL(gateEnvironment().VIJEETA_V3_BASE_URL!);
const V3_ORIGIN = V3_BASE_URL.origin;
const JOB_ID = "gate-job-1";
const PROTOCOL_RELATIVE_JOB_ID = "gate-job-protocol-relative";
const ABSOLUTE_JOB_ID = "gate-job-absolute";
const SHARE_ID = "gate-share-1";
const TEST_ID = "gate-test-1";
const RUNNER_PATH = "/t/gate-runner-capability-1";

async function body(response: Response): Promise<Record<string, never>> {
  return await response.json() as Record<string, never>;
}

gate("connected dashboard release gate", () => {
  let runtime: GateRuntime;
  let admin: GateIdentity;
  let teacher: GateIdentity;
  let rival: GateIdentity;
  let student: GateIdentity;
  let classmate: GateIdentity;
  let outsider: GateIdentity;
  let v3: ReturnType<typeof strictV3Fetch>;
  let openAt: string;
  let closeAt: string;

  beforeAll(async () => {
    await resetEmulators();
    runtime = await buildGateRuntime();
    admin = await createIdentity(ADMIN_EMAIL);
    teacher = await createIdentity("gate-teacher@example.test");
    rival = await createIdentity("gate-rival@example.test");
    student = await createIdentity("gate-student@example.test");
    classmate = await createIdentity("gate-classmate@example.test");
    outsider = await createIdentity("gate-outsider@example.test");
    const second = Math.floor(Date.now() / 1000) * 1000;
    openAt = new Date(second - 3_600_000).toISOString();
    closeAt = new Date(second + 3_600_000).toISOString();
    v3 = strictV3Fetch({
      [`POST /v3/paperdesk/jobs/${JOB_ID}/share`]: {
        ok: true,
        share: {
          id: SHARE_ID, job_id: JOB_ID, test_id: TEST_ID, token: "upstream-secret",
          emails: [student.email, classmate.email],
          readout: { resolved: 2, batches: 1, warnings: ["two recipients resolved"] },
        },
        link: `${V3_ORIGIN}${RUNNER_PATH}`,
      },
      [`POST /v3/paperdesk/jobs/${PROTOCOL_RELATIVE_JOB_ID}/share`]: {
        ok: true,
        share: { id: "gate-share-2", job_id: PROTOCOL_RELATIVE_JOB_ID, test_id: "gate-test-2", readout: { resolved: 2, batches: 1, warnings: [] } },
        link: "//attacker.example.test/t/gate-runner-capability-2",
      },
      [`POST /v3/paperdesk/jobs/${ABSOLUTE_JOB_ID}/share`]: {
        ok: true,
        share: { id: "gate-share-3", job_id: ABSOLUTE_JOB_ID, test_id: "gate-test-3", readout: { resolved: 2, batches: 1, warnings: [] } },
        link: "https://attacker.example.test/t/gate-runner-capability-3",
      },
      [`GET /v3/paperdesk/shares/${SHARE_ID}/results`]: {
        share: { id: SHARE_ID, test_id: TEST_ID, by: teacher.email, token: "upstream-secret" },
        funnel: { shared: 2, attempted: 1, pending: 1 },
        batch: { mean: 42, median: 42 },
        students: [
          { uid: student.uid, attempted: true, score: 42, max: 100, accuracy: 0.42, time_ms: 120_000 },
          { uid: classmate.uid, attempted: false, score: null, max: null, accuracy: null, time_ms: null },
        ],
      },
      [`GET /v3/paperdesk/shares/${SHARE_ID}/student/${student.uid}/analysis`]: {
        test_id: TEST_ID, title: "Mechanics", score: 42, max: 100, percentile: { percentile: 80 }, delta_last: 5,
      },
      [`GET /v3/paperdesk/shares/${SHARE_ID}/student/${classmate.uid}/analysis`]: {
        test_id: TEST_ID, title: "Mechanics", score: null, max: 100, percentile: { percentile: 20 }, delta_last: null,
      },
      [`GET /v3/test/${TEST_ID}/analysis`]: {
        test_id: TEST_ID, title: "Mechanics", score: 42, max: 100, percentile: { percentile: 80 }, delta_last: 5,
      },
    });
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
  const v3Options = () => ({ baseUrl: V3_BASE_URL, fetchImpl: v3.fetchImpl });
  const assignmentRoutes = () => createClassroomAssignmentsRouteHandlers({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    assignments: runtime.runtime.dashboard,
    assignmentAdapter: new V3AssignmentAdapter(v3Options()),
  });
  const launchRoute = () => createAssignmentLaunchRouteHandler({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    assignments: runtime.runtime.dashboard,
  });
  const insightsRoute = () => createAssignmentInsightsRouteHandler({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    assignments: runtime.runtime.dashboard,
    insights: new V3InsightAdapter(v3Options()),
  });
  const individualInsightRoute = () => createStudentAssignmentInsightRouteHandler({
    verifier: runtime.runtime.verifier,
    profiles: runtime.runtime.dashboard,
    assignments: runtime.runtime.dashboard,
    insights: new V3InsightAdapter(v3Options()),
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

  it("onboards a Teacher as active, with no approval step", async () => {
    const onboarded = await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(teacher)), "content-type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    }));
    expect(onboarded.status).toBe(201);
    const payload = await body(onboarded) as unknown as { profile: { roles: Record<string, string>; activeRole: string } };
    expect(payload.profile.roles.teacher).toBe("active");
    expect(payload.profile.activeRole).toBe("teacher");
  });

  it("still lets an Admin suspend a Teacher and restore them", async () => {
    const listed = await adminProfileRoutes().GET(request("/api/admin/profiles", { headers: await bearer(admin) }));
    expect(listed.status).toBe(200);
    const adminPrincipal = await runtime.runtime.verifier.verify(`Bearer ${await admin.idToken()}`);

    const suspended = await runtime.runtime.dashboard.suspendTeacher(
      adminPrincipal, teacher.uid,
      { now: new Date().toISOString(), correlationId: randomUUID(), reason: "Release gate suspension" },
    );
    expect(suspended.roles.teacher).toBe("suspended");

    // A suspended Teacher loses authority immediately.
    const denied = await classRoutes().POST(request("/api/classes", {
      method: "POST",
      headers: { ...(await bearer(teacher)), "content-type": "application/json" },
      body: JSON.stringify({ name: "Denied While Suspended" }),
    }));
    expect(denied.status).toBe(403);

    const restored = await runtime.runtime.dashboard.approveTeacher(
      adminPrincipal, teacher.uid,
      { now: new Date().toISOString(), correlationId: randomUUID(), reason: "Release gate restore" },
    );
    expect(restored.roles.teacher).toBe("active");
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


  it("onboards a second Teacher who owns no class", async () => {
    const onboarded = await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(rival)), "content-type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    }));
    expect(onboarded.status).toBe(201);
    const payload = await body(onboarded) as unknown as { profile: { roles: Record<string, string> } };
    expect(payload.profile.roles.teacher).toBe("active");
  });

  it("adds a second student to the class so the assignment carries two recipients", async () => {
    await profileRoutes().POST(request("/api/profile", {
      method: "POST",
      headers: { ...(await bearer(classmate)), "content-type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    }));
    const invited = await memberRoutes().POST(
      request(`/api/classes/${classroomId}/members`, {
        method: "POST",
        headers: { ...(await bearer(teacher)), "content-type": "application/json" },
        body: JSON.stringify({ email: classmate.email }),
      }),
      routeContext({ id: classroomId }),
    );
    expect(invited.status).toBe(201);
    const captures = runtime.captures();
    expect(captures).toHaveLength(2);
    const token = new URL(captures[1]!.invitationUrl).hash.replace(/^#/, "").replace("token=", "");
    const accepted = await acceptRoute()(request("/api/invitations/accept", {
      method: "POST",
      headers: { ...(await bearer(classmate)), "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }));
    expect(accepted.status).toBe(200);
  });

  const createAssignment = async (identity: GateIdentity, jobId: string): Promise<Response> => assignmentRoutes().POST(
    request(`/api/classes/${classroomId}/assignments`, {
      method: "POST",
      headers: { ...(await bearer(identity)), "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ jobId, openAt, closeAt, solutions: "after_close" }),
    }),
    routeContext({ id: classroomId }),
  );

  let assignmentId: string;

  it("creates an assignment through the real V3 share transport", async () => {
    const created = await createAssignment(teacher, JOB_ID);
    expect(created.status).toBe(201);
    const payload = await body(created) as unknown as {
      assignment: { id: string; state: string; testId: string; shareId: string; recipientCount: number; runnerPath?: string };
    };
    assignmentId = payload.assignment.id;
    expect(payload.assignment.state).toBe("active");
    expect(payload.assignment.testId).toBe(TEST_ID);
    expect(payload.assignment.shareId).toBe(SHARE_ID);
    expect(payload.assignment.recipientCount).toBe(2);
    expect(payload.assignment.runnerPath).toBeUndefined();
    expect(v3.calls).toContain(`POST /v3/paperdesk/jobs/${JOB_ID}/share`);
    const stored = await runtime.runtime.dashboard.getAssignment(classroomId, assignmentId);
    expect(stored?.state).toBe("active");
    expect(stored?.runnerPath).toBe(RUNNER_PATH);
    expect(stored?.recipientSnapshot.map((recipient) => recipient.email).sort())
      .toEqual([classmate.email, student.email].sort());
  }, 30_000);

  it("refuses assignment creation to a Teacher who does not own the class", async () => {
    const response = await createAssignment(rival, "gate-job-rival");
    expect([403, 404]).toContain(response.status);
  });

  it("lists the assignment for the owning Teacher and for a recipient Student", async () => {
    for (const identity of [teacher, student]) {
      const listed = await assignmentRoutes().GET(
        request(`/api/classes/${classroomId}/assignments`, { headers: await bearer(identity) }),
        routeContext({ id: classroomId }),
      );
      expect(listed.status).toBe(200);
      const payload = await body(listed) as unknown as { assignments: { id: string; runnerPath?: string }[] };
      expect(payload.assignments.map((entry) => entry.id)).toEqual([assignmentId]);
      expect(payload.assignments[0]!.runnerPath).toBeUndefined();
    }
  });

  it("launches the assignment for a recipient Student", async () => {
    const response = await launchRoute()(
      request(`/api/assignments/${assignmentId}/launch`, { headers: await bearer(student) }),
      routeContext({ id: assignmentId }),
    );
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as { runnerPath: string };
    expect(payload.runnerPath).toBe(RUNNER_PATH);
    expect(payload.runnerPath).toMatch(/^\/t\/[A-Za-z0-9_-]{16,256}$/);
  });

  it("refuses a launch to a Student who is not a member of the class", async () => {
    const response = await launchRoute()(
      request(`/api/assignments/${assignmentId}/launch`, { headers: await bearer(outsider) }),
      routeContext({ id: assignmentId }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("refuses a launch to the owning Teacher", async () => {
    const response = await launchRoute()(
      request(`/api/assignments/${assignmentId}/launch`, { headers: await bearer(teacher) }),
      routeContext({ id: assignmentId }),
    );
    expect(response.status).toBe(403);
  });

  it("serves the aggregate insight to the owning Teacher", async () => {
    const response = await insightsRoute()(
      request(`/api/assignments/${assignmentId}/insights`, { headers: await bearer(teacher) }),
      routeContext({ id: assignmentId }),
    );
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as {
      freshness: string;
      insights: { aggregate: { attempted: number; pending: number; averageScore: number }; personal?: unknown; individual?: unknown };
    };
    expect(payload.insights.aggregate).toEqual({ attempted: 1, pending: 1, averageScore: 42 });
    expect(payload.insights.personal).toBeUndefined();
    expect(payload.insights.individual).toBeUndefined();
    expect(v3.calls).toContain(`GET /v3/paperdesk/shares/${SHARE_ID}/results`);
  });

  it("refuses the aggregate insight to a Teacher who does not own the class", async () => {
    const response = await insightsRoute()(
      request(`/api/assignments/${assignmentId}/insights`, { headers: await bearer(rival) }),
      routeContext({ id: assignmentId }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("serves only the personal insight to a recipient Student", async () => {
    const response = await insightsRoute()(
      request(`/api/assignments/${assignmentId}/insights`, { headers: await bearer(student) }),
      routeContext({ id: assignmentId }),
    );
    expect(response.status).toBe(200);
    const payload = await body(response) as unknown as {
      insights: { personal: { attempted: number; score: number; latestScore: number | null }; aggregate?: unknown };
    };
    expect(payload.insights.personal).toEqual({ attempted: 1, averageScore: 42, score: 42, latestScore: 42 });
    expect(payload.insights.aggregate).toBeUndefined();
    expect(v3.calls).toContain(`GET /v3/test/${TEST_ID}/analysis`);
  });

  it("refuses assignment insights to a Student outside the recipient snapshot", async () => {
    const response = await insightsRoute()(
      request(`/api/assignments/${assignmentId}/insights`, { headers: await bearer(outsider) }),
      routeContext({ id: assignmentId }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("serves an individual insight for each recipient to the owning Teacher", async () => {
    const attempted = await individualInsightRoute()(
      request(`/api/assignments/${assignmentId}/students/${student.uid}/insights`, { headers: await bearer(teacher) }),
      routeContext({ id: assignmentId, uid: student.uid }),
    );
    expect(attempted.status).toBe(200);
    const attemptedPayload = await body(attempted) as unknown as {
      insights: { individual: { uid: string; displayName: string; score: number | null; status: string } };
    };
    expect(attemptedPayload.insights.individual.uid).toBe(student.uid);
    expect(attemptedPayload.insights.individual.status).toBe("attempted");
    expect(attemptedPayload.insights.individual.score).toBe(42);

    const pending = await individualInsightRoute()(
      request(`/api/assignments/${assignmentId}/students/${classmate.uid}/insights`, { headers: await bearer(teacher) }),
      routeContext({ id: assignmentId, uid: classmate.uid }),
    );
    expect(pending.status).toBe(200);
    const pendingPayload = await body(pending) as unknown as {
      insights: { individual: { uid: string; score: number | null; status: string } };
    };
    expect(pendingPayload.insights.individual.uid).toBe(classmate.uid);
    expect(pendingPayload.insights.individual.status).toBe("pending");
    expect(pendingPayload.insights.individual.score).toBeNull();
  });

  it("refuses one Student the individual insight of another Student", async () => {
    const response = await individualInsightRoute()(
      request(`/api/assignments/${assignmentId}/students/${student.uid}/insights`, { headers: await bearer(classmate) }),
      routeContext({ id: assignmentId, uid: student.uid }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("refuses an individual insight for a uid outside the recipient snapshot", async () => {
    const response = await individualInsightRoute()(
      request(`/api/assignments/${assignmentId}/students/${outsider.uid}/insights`, { headers: await bearer(teacher) }),
      routeContext({ id: assignmentId, uid: outsider.uid }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("refuses an individual insight to a Teacher who does not own the class", async () => {
    const response = await individualInsightRoute()(
      request(`/api/assignments/${assignmentId}/students/${student.uid}/insights`, { headers: await bearer(rival) }),
      routeContext({ id: assignmentId, uid: student.uid }),
    );
    expect([403, 404]).toContain(response.status);
  });

  it("never activates an assignment on a protocol-relative or absolute runner link", async () => {
    for (const jobId of [PROTOCOL_RELATIVE_JOB_ID, ABSOLUTE_JOB_ID]) {
      const created = await createAssignment(teacher, jobId);
      expect(created.status).toBe(201);
      const payload = await body(created) as unknown as {
        assignment: { id: string; state: string; testId: string | null; shareId: string | null; reconciliation: { reason: string } | null };
      };
      expect(payload.assignment.state).toBe("reconciliation_required");
      expect(payload.assignment.reconciliation?.reason).toBe("malformed_success");
      expect(payload.assignment.testId).toBeNull();
      expect(payload.assignment.shareId).toBeNull();
      const stored = await runtime.runtime.dashboard.getAssignment(classroomId, payload.assignment.id);
      expect(stored?.runnerPath).toBeNull();
      const launched = await launchRoute()(
        request(`/api/assignments/${payload.assignment.id}/launch`, { headers: await bearer(student) }),
        routeContext({ id: payload.assignment.id }),
      );
      expect(launched.status).toBe(409);
    }
  }, 30_000);

  it("reached only the approved V3 origin and only the expected V3 paths", async () => {
    expect(v3.unexpected).toEqual([]);
    expect(new Set(v3.calls)).toEqual(new Set([
      `POST /v3/paperdesk/jobs/${JOB_ID}/share`,
      `POST /v3/paperdesk/jobs/${PROTOCOL_RELATIVE_JOB_ID}/share`,
      `POST /v3/paperdesk/jobs/${ABSOLUTE_JOB_ID}/share`,
      `GET /v3/paperdesk/shares/${SHARE_ID}/results`,
      `GET /v3/paperdesk/shares/${SHARE_ID}/student/${student.uid}/analysis`,
      `GET /v3/paperdesk/shares/${SHARE_ID}/student/${classmate.uid}/analysis`,
      `GET /v3/test/${TEST_ID}/analysis`,
    ]));
  });

});
