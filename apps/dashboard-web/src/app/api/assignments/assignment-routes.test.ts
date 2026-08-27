import { describe, expect, it, vi } from "vitest";

import type {
  ClassroomAssignment,
  DashboardProfileV2,
  V3IndividualTestInsight,
  V3ShareResult,
  V3ShareResults,
  VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import type { AssignmentRepository, ProfileRepository } from "../../../server/dashboard-store";
import { V3AdapterError } from "../../../server/v3-assignment-adapter";
import { createClassroomAssignmentsRouteHandlers } from "../classes/[id]/assignments/route";
import { createAssignmentInsightsRouteHandler } from "./[id]/insights/route";
import { createAssignmentLaunchRouteHandler } from "./[id]/launch/route";
import { createReconcileAssignmentRouteHandler } from "./[id]/reconcile/route";
import { createStudentAssignmentInsightRouteHandler } from "./[id]/students/[uid]/insights/route";

const NOW = "2026-08-28T08:00:00.000Z";
const OPEN = "2026-08-28T07:00:00.000Z";
const CLOSE = "2026-08-28T09:00:00.000Z";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const principal: VerifiedPrincipal = { uid: "teacher-uid", email: "teacher@example.test", emailVerified: true, displayName: "Teacher", authTime: NOW };
const studentPrincipal: VerifiedPrincipal = { uid: "student-uid", email: "student@example.test", emailVerified: true, displayName: "Student", authTime: NOW };
const teacherProfile: DashboardProfileV2 = { internalProfileId: "profile-teacher", firebaseUid: principal.uid, verifiedEmail: principal.email, displayName: "Teacher", roles: { teacher: "active" }, activeRole: "teacher", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };
const studentProfile: DashboardProfileV2 = { internalProfileId: "profile-student", firebaseUid: studentPrincipal.uid, verifiedEmail: studentPrincipal.email, displayName: "Student", roles: { student: "active" }, activeRole: "student", onboardingCompleted: true, schemaVersion: 2, createdAt: NOW, updatedAt: NOW };

const creating: ClassroomAssignment = { id: "assignment-1", classroomId: "class-1", ownerUid: principal.uid, jobId: "job-1", recipientSnapshot: [{ uid: studentPrincipal.uid, email: studentPrincipal.email! }], openAt: OPEN, closeAt: CLOSE, solutions: "after_close", state: "creating", testId: null, shareId: null, runnerPath: null, reconciliation: null, createdAt: NOW, updatedAt: NOW };
const active: ClassroomAssignment = { ...creating, state: "active", testId: "test-1", shareId: "share-1", runnerPath: "/t/abcdefghijklmnop", reconciliation: null };
const reconciling: ClassroomAssignment = { ...creating, state: "reconciliation_required", reconciliation: { reason: "unknown", requiredAt: NOW } };

function request(method: string, url: string, body?: unknown) {
  return new Request(url, { method, headers: { authorization: "Bearer abcdefghijklmnopqrst", "idempotency-key": CORRELATION_ID, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function profileReader(actor: DashboardProfileV2): Pick<ProfileRepository, "getProfile"> {
  return { getProfile: vi.fn(async () => actor) };
}

describe("assignment API orchestration", () => {
  it("claims one immutable assignment operation and calls V3 only for its creator", async () => {
    const assignments = {
      prepareAssignment: vi.fn(async () => ({ disposition: "created" as const, assignment: creating })),
      claimAssignmentShare: vi.fn(async () => ({ claimed: true as const, operationId: "operation-1", assignment: reconciling })),
      completeAssignmentShare: vi.fn(async (_principal, _id, _operation, outcome) => outcome.kind === "active" ? active : reconciling),
      listAssignmentsForPrincipalPage: vi.fn(),
    } as unknown as AssignmentRepository;
    const shareResult: V3ShareResult = { shareId: "share-1", testId: "test-1", runnerPath: "/t/abcdefghijklmnop", readout: { resolved: 1, batches: 0, warnings: [] } };
    const share = vi.fn(async () => shareResult);
    const handlers = createClassroomAssignmentsRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments, assignmentAdapter: { share }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const response = await handlers.POST(request("POST", "http://localhost/api/classes/class-1/assignments", { jobId: "job-1", openAt: OPEN, closeAt: CLOSE, solutions: "after_close" }), { params: Promise.resolve({ id: "class-1" }) });
    expect(response.status).toBe(201);
    const { recipientSnapshot: _privateRecipients, ...safeAssignment } = active;
    expect(_privateRecipients).toHaveLength(1);
    expect(await response.json()).toEqual({ assignment: { ...safeAssignment, recipientCount: 1 } });
    expect(share).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith({ jobId: "job-1", recipientEmails: ["student@example.test"], openAt: OPEN, closeAt: CLOSE, solutions: "after_close" }, "abcdefghijklmnopqrst");
  });

  it("does not retry an idempotent or ambiguous V3 share", async () => {
    const assignments = {
      prepareAssignment: vi.fn(async () => ({ disposition: "idempotent_replay" as const, assignment: reconciling })),
      claimAssignmentShare: vi.fn(), completeAssignmentShare: vi.fn(), listAssignmentsForPrincipalPage: vi.fn(),
    } as unknown as AssignmentRepository;
    const share = vi.fn();
    const replay = createClassroomAssignmentsRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments, assignmentAdapter: { share }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const response = await replay.POST(request("POST", "http://localhost/api/classes/class-1/assignments", { jobId: "job-1", openAt: OPEN, closeAt: CLOSE, solutions: "after_close" }), { params: Promise.resolve({ id: "class-1" }) });
    expect(response.status).toBe(200);
    expect(share).not.toHaveBeenCalled();
    expect(assignments.claimAssignmentShare).not.toHaveBeenCalled();
  });

  it("requires a separate validated idempotency key and redacts recipients from lists", async () => {
    const assignments = {
      prepareAssignment: vi.fn(), claimAssignmentShare: vi.fn(), completeAssignmentShare: vi.fn(),
      listAssignmentsForPrincipalPage: vi.fn(async () => ({ items: [active], nextCursor: null })),
    } as unknown as AssignmentRepository;
    const handlers = createClassroomAssignmentsRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments, assignmentAdapter: { share: vi.fn() }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const missingKey = new Request("http://localhost/api/classes/class-1/assignments", { method: "POST", headers: { authorization: "Bearer abcdefghijklmnopqrst", "content-type": "application/json" }, body: JSON.stringify({ jobId: "job-1", openAt: OPEN, closeAt: CLOSE, solutions: "after_close" }) });
    expect((await handlers.POST(missingKey, { params: Promise.resolve({ id: "class-1" }) })).status).toBe(400);
    expect(assignments.prepareAssignment).not.toHaveBeenCalled();
    const listed = await handlers.GET(request("GET", "http://localhost/api/classes/class-1/assignments?limit=10"), { params: Promise.resolve({ id: "class-1" }) });
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.assignments[0]).toMatchObject({ id: "assignment-1", recipientCount: 1 });
    expect(JSON.stringify(body)).not.toContain("student@example.test");
    expect(JSON.stringify(body)).not.toContain("student-uid");
  });

  it("maps an ambiguous V3 outcome to reconciliation and a definite rejection to failed", async () => {
    for (const [error, kind] of [[new V3AdapterError("ambiguous_outcome", "timeout", false), "reconciliation_required"], [new V3AdapterError("definite_rejection", "v3_403", false, 403), "failed"]] as const) {
      const completed = kind === "failed" ? { ...creating, state: "failed" as const, failureCode: "v3_403" } : reconciling;
      const assignments = {
        prepareAssignment: vi.fn(async () => ({ disposition: "created" as const, assignment: creating })),
        claimAssignmentShare: vi.fn(async () => ({ claimed: true as const, operationId: "operation-1", assignment: reconciling })),
        completeAssignmentShare: vi.fn(async () => completed), listAssignmentsForPrincipalPage: vi.fn(),
      } as unknown as AssignmentRepository;
      const handlers = createClassroomAssignmentsRouteHandlers({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments, assignmentAdapter: { share: vi.fn(async () => { throw error; }) }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
      const response = await handlers.POST(request("POST", "http://localhost/api/classes/class-1/assignments", { jobId: "job-1", openAt: OPEN, closeAt: CLOSE, solutions: "after_close" }), { params: Promise.resolve({ id: "class-1" }) });
      expect(response.status).toBe(201);
      expect((await response.json()).assignment.state).toBe(kind);
      expect(assignments.completeAssignmentShare).toHaveBeenCalledOnce();
    }
  });
});

describe("assignment read and reconciliation authority", () => {
  it("allows only the snapshotted active Student to launch the persisted safe runner path", async () => {
    const getAssignmentForStudent = vi.fn(async () => active);
    const handler = createAssignmentLaunchRouteHandler({ verifier: { verify: vi.fn(async () => studentPrincipal) }, profiles: profileReader(studentProfile), assignments: { getAssignmentForStudent } as unknown as AssignmentRepository, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const response = await handler(request("GET", "http://localhost/api/assignments/assignment-1/launch"), { params: Promise.resolve({ id: "assignment-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runnerPath: "/t/abcdefghijklmnop" });
  });

  it("enforces launch window boundaries and denies Teacher/Admin workspaces", async () => {
    const assignmentStore = { getAssignmentForStudent: vi.fn(async () => active) } as unknown as AssignmentRepository;
    for (const [actor, actorProfile, instant, expected] of [
      [studentPrincipal, studentProfile, "2026-08-28T06:59:59.000Z", 409],
      [studentPrincipal, studentProfile, CLOSE, 409],
      [principal, teacherProfile, NOW, 403],
      [principal, { ...teacherProfile, roles: { admin: "active" as const }, activeRole: "admin" as const }, NOW, 403],
    ] as const) {
      const handler = createAssignmentLaunchRouteHandler({ verifier: { verify: vi.fn(async () => actor) }, profiles: profileReader(actorProfile), assignments: assignmentStore, now: () => instant, createCorrelationId: () => CORRELATION_ID });
      const response = await handler(request("GET", "http://localhost/api/assignments/assignment-1/launch"), { params: Promise.resolve({ id: "assignment-1" }) });
      expect(response.status).toBe(expected);
    }
  });

  it("forces Student self insight UID and checks Teacher recipient authority before V3", async () => {
    const personal: V3IndividualTestInsight = { uid: "student-uid", testId: "test-1", available: true, title: "Physics", score: 8, maxScore: 10, percentile: 90, deltaFromPrevious: 1 };
    const studentTestAnalysis = vi.fn(async () => personal);
    const selfHandler = createAssignmentInsightsRouteHandler({ verifier: { verify: vi.fn(async () => studentPrincipal) }, profiles: profileReader(studentProfile), assignments: { getAssignmentForStudent: vi.fn(async () => active) } as unknown as AssignmentRepository, insights: { shareResults: vi.fn(), studentAnalysis: vi.fn(), studentTestAnalysis }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const response = await selfHandler(request("GET", "http://localhost/api/assignments/assignment-1/insights"), { params: Promise.resolve({ id: "assignment-1" }) });
    expect(response.status).toBe(200);
    expect(studentTestAnalysis).toHaveBeenCalledWith("test-1", "student-uid", "abcdefghijklmnopqrst");

    const individual = vi.fn(async () => personal);
    const teacherHandler = createStudentAssignmentInsightRouteHandler({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments: { getOwnedAssignment: vi.fn(async () => active) } as unknown as AssignmentRepository, insights: { studentAnalysis: individual }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const denied = await teacherHandler(request("GET", "http://localhost/api/assignments/assignment-1/students/other-uid/insights"), { params: Promise.resolve({ id: "assignment-1", uid: "other-uid" }) });
    expect(denied.status).toBe(403);
    expect(individual).not.toHaveBeenCalled();
  });

  it("denies Admin insight authority before any V3 adapter call", async () => {
    const adminProfile: DashboardProfileV2 = { ...teacherProfile, roles: { admin: "active" }, activeRole: "admin" };
    const shareResults = vi.fn();
    const studentAnalysis = vi.fn();
    const handler = createAssignmentInsightsRouteHandler({
      verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(adminProfile),
      assignments: { getOwnedAssignment: vi.fn(), getAssignmentForStudent: vi.fn() } as unknown as AssignmentRepository,
      insights: { shareResults, studentAnalysis, studentTestAnalysis: vi.fn() }, now: () => NOW, createCorrelationId: () => CORRELATION_ID,
    });
    const response = await handler(request("GET", "http://localhost/api/assignments/assignment-1/insights"), { params: Promise.resolve({ id: "assignment-1" }) });
    expect(response.status).toBe(403);
    expect(shareResults).not.toHaveBeenCalled();
    expect(studentAnalysis).not.toHaveBeenCalled();
  });

  it("verifies an explicit existing share but fails closed without a safe runner path, and never retries", async () => {
    const results: V3ShareResults = { shareId: "share-1", testId: "test-1", funnel: { shared: 1, attempted: 0, pending: 1 }, averageScore: null, students: [] };
    const shareResults = vi.fn(async () => results);
    const assignments = { getOwnedAssignment: vi.fn(async () => reconciling) } as unknown as AssignmentRepository;
    const handler = createReconcileAssignmentRouteHandler({ verifier: { verify: vi.fn(async () => principal) }, profiles: profileReader(teacherProfile), assignments, insights: { shareResults }, now: () => NOW, createCorrelationId: () => CORRELATION_ID });
    const linked = await handler(request("POST", "http://localhost/api/assignments/assignment-1/reconcile", { resolution: "link_existing_share", shareId: "share-1", reason: "Verified in V3 owner results" }), { params: Promise.resolve({ id: "assignment-1" }) });
    expect(linked.status).toBe(409);
    const unsupported = await handler(request("POST", "http://localhost/api/assignments/assignment-1/reconcile", { resolution: "retry_confirmed_absent", reason: "No share visible" }), { params: Promise.resolve({ id: "assignment-1" }) });
    expect(unsupported.status).toBe(409);
    expect(shareResults).toHaveBeenCalledOnce();
  });
});
