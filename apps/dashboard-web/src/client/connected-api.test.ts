import { describe, expect, it, vi } from "vitest";

import { createConnectedApi, ConnectedApiError } from "./connected-api";

const NOW = "2026-08-28T10:00:00.000Z";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000009";

function response(body: unknown, status = 200, url = "https://dashboard.example/api/profile") {
  const result = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

const profile = {
  internalProfileId: "profile-1",
  firebaseUid: "uid-1",
  verifiedEmail: "learner@example.test",
  displayName: "Learner",
  roles: { student: "active" as const },
  activeRole: "student" as const,
  onboardingCompleted: true,
  schemaVersion: 2 as const,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("connected same-origin API", () => {
  it("obtains a token for each call without retaining or serializing it", async () => {
    const getIdToken = vi.fn(async () => "secret-bearer");
    const transport = vi.fn(async () => response({ profile }));
    const api = createConnectedApi({ getIdToken, transport, origin: "https://dashboard.example" });

    await api.getProfile();
    await api.getProfile();

    expect(getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(getIdToken).toHaveBeenNthCalledWith(2, false);
    expect(JSON.stringify(api)).not.toContain("secret-bearer");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("retries a safe GET once after 401 with a forced fresh token", async () => {
    const getIdToken = vi.fn(async (force: boolean) => force ? "fresh-token" : "stale-token");
    const transport = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: "unauthenticated", message: "Sign in", correlationId: CORRELATION_ID, retryable: false } }, 401))
      .mockResolvedValueOnce(response({ profile }));
    const onAuthorizationLost = vi.fn();
    const api = createConnectedApi({ getIdToken, transport, origin: "https://dashboard.example", onAuthorizationLost });

    await expect(api.getProfile()).resolves.toEqual(profile);

    expect(getIdToken.mock.calls).toEqual([[false], [true]]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
  });

  it("never retries mutations or a forbidden response and clears authorization state", async () => {
    const getIdToken = vi.fn(async () => "do-not-print");
    const unauthorized = response({ error: { code: "unauthenticated", message: "Sign in", correlationId: CORRELATION_ID, retryable: false } }, 401);
    const forbidden = response({ error: { code: "forbidden", message: "Not permitted", correlationId: CORRELATION_ID, retryable: false } }, 403);
    const mutationTransport = vi.fn(async () => unauthorized);
    const mutationLost = vi.fn();
    const mutationApi = createConnectedApi({ getIdToken, transport: mutationTransport, origin: "https://dashboard.example", onAuthorizationLost: mutationLost });
    await expect(mutationApi.onboard("student")).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    expect(mutationTransport).toHaveBeenCalledTimes(1);
    expect(mutationLost).toHaveBeenCalledTimes(1);

    const readTransport = vi.fn(async () => forbidden);
    const readLost = vi.fn();
    const readApi = createConnectedApi({ getIdToken, transport: readTransport, origin: "https://dashboard.example", onAuthorizationLost: readLost });
    await expect(readApi.getProfile()).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(readTransport).toHaveBeenCalledTimes(1);
    expect(readLost).toHaveBeenCalledTimes(1);
  });

  it("uses only fixed, encoded same-origin routes for approved profile and class operations", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const classroom = { id: "class-1", ownerUid: "uid-1", name: "Physics", status: "active", createdAt: NOW, updatedAt: NOW };
    const queue = [
      { profile }, { profile }, { profile },
      { classrooms: [classroom], nextCursor: null }, { classroom }, { classroom }, { classroom },
      { members: [], invitations: [], nextMemberCursor: null, nextInvitationCursor: null },
    ];
    const transport = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ input: String(input), init });
      return response(queue.shift(), 200, `https://dashboard.example${String(input)}`);
    });
    const api = createConnectedApi({ getIdToken: async () => "token", transport, origin: "https://dashboard.example" });

    await api.getProfile();
    await api.onboard("student");
    await api.setActiveRole("student");
    await api.listClasses({ limit: 25, cursor: "next page" });
    await api.createClassroom({ name: "Physics" });
    await api.getClassroom("class/1");
    await api.archiveClassroom("class/1");
    await api.getClassroomRoster("class/1", { limit: 10 });

    expect(calls.map(({ input, init }) => [init.method ?? "GET", input])).toEqual([
      ["GET", "/api/profile"],
      ["POST", "/api/profile"],
      ["POST", "/api/profile/active-role"],
      ["GET", "/api/classes?limit=25&cursor=next+page"],
      ["POST", "/api/classes"],
      ["GET", "/api/classes/class%2F1"],
      ["POST", "/api/classes/class%2F1/archive"],
      ["GET", "/api/classes/class%2F1/members?limit=10"],
    ]);
    expect("request" in api).toBe(false);
  });

  it("binds every Admin, invitation, and assignment method to its exact reviewed route", async () => {
    const classroom = { id: "class-1", ownerUid: "uid-1", name: "Physics", status: "active", createdAt: NOW, updatedAt: NOW };
    const invite = { id: "invite-1", classroomId: "class-1", ownerUid: "uid-1", tokenVersion: 1, expiresAt: NOW, status: "pending", delivery: "sent", acceptedUid: null, acceptedAt: null, createdAt: NOW, updatedAt: NOW };
    const membership = { classroomId: "class-1", studentUid: "uid-1", sourceInviteId: "invite-1", status: "active", joinedAt: NOW, updatedAt: NOW };
    const assignment = { id: "assignment-1", classroomId: "class-1", ownerUid: "uid-1", jobId: "job-1", recipientCount: 1, openAt: NOW, closeAt: null, solutions: "never", createdAt: NOW, updatedAt: NOW, state: "active", testId: "test-1", shareId: "share-1", reconciliation: null };
    const outputs: unknown[] = [
      { profiles: [profile], nextCursor: null }, { profile }, { profile },
      { classrooms: [classroom], nextCursor: null }, { classroom }, { classroom },
      { invitations: [invite], nextCursor: null }, { invite }, { invite }, { events: [], nextCursor: null },
      { invite }, { invite }, { invite },
      { inviteId: "invite-1", classroomId: "class-1", classroomName: "Physics", teacherDisplayName: "Teacher", targetEmailMatches: true, studentOnboardingRequired: false, expiresAt: NOW, status: "pending" },
      { membership }, { assignments: [assignment], nextCursor: null }, { assignment }, { runnerPath: "/t/capability" },
      { freshness: NOW, insights: { personal: { attempted: 1, averageScore: 80, score: 80, latestScore: 80 } } },
      { freshness: NOW, insights: { individual: { uid: "uid-1", displayName: "Learner", score: 80, status: "attempted" } } },
      { assignment },
    ];
    const calls: Array<[string, string]> = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push([String(init.method ?? "GET"), String(input)]);
      return response(outputs.shift(), 200, `https://dashboard.example${String(input)}`);
    });
    const api = createConnectedApi({ getIdToken: async () => "token", transport, origin: "https://dashboard.example" });
    const reason = { reason: "Reviewed request" };

    await api.listAdminProfiles(); await api.approveTeacher("teacher/1", reason); await api.suspendTeacher("teacher/1", reason);
    await api.listAdminClassrooms(); await api.archiveAdminClassroom("class/1", reason); await api.restoreAdminClassroom("class/1", reason);
    await api.listAdminInvitations(); await api.revokeAdminInvitation("invite/1", reason); await api.redeliverAdminInvitation("invite/1", reason); await api.listAdminAudit();
    await api.inviteClassroomMember("class/1", { email: "learner@example.test" });
    await api.revokeClassroomInvitation("class/1", "invite/1"); await api.redeliverClassroomInvitation("class/1", "invite/1");
    await api.inspectInvitation("invite-1.secret"); await api.acceptInvitation("invite-1.secret");
    await api.listAssignments("class/1");
    await api.createAssignment("class/1", { jobId: "job-1", openAt: NOW, closeAt: null, solutions: "never" });
    await api.launchAssignment("assignment/1"); await api.getAssignmentInsights("assignment/1");
    await api.getStudentAssignmentInsights("assignment/1", "student/1");
    await api.reconcileAssignment("assignment/1", { resolution: "link_existing_share", shareId: "share-1", reason: "Verified in V3" });

    expect(calls).toEqual([
      ["GET", "/api/admin/profiles"], ["POST", "/api/admin/teachers/teacher%2F1/approve"], ["POST", "/api/admin/teachers/teacher%2F1/suspend"],
      ["GET", "/api/admin/classrooms"], ["POST", "/api/admin/classrooms/class%2F1/archive"], ["POST", "/api/admin/classrooms/class%2F1/restore"],
      ["GET", "/api/admin/invitations"], ["POST", "/api/admin/invitations/invite%2F1/revoke"], ["POST", "/api/admin/invitations/invite%2F1/redeliver"], ["GET", "/api/admin/audit"],
      ["POST", "/api/classes/class%2F1/members"], ["POST", "/api/classes/class%2F1/invitations/invite%2F1/revoke"], ["POST", "/api/classes/class%2F1/invitations/invite%2F1/redeliver"],
      ["POST", "/api/invitations/inspect"], ["POST", "/api/invitations/accept"], ["GET", "/api/classes/class%2F1/assignments"],
      ["POST", "/api/classes/class%2F1/assignments"], ["GET", "/api/assignments/assignment%2F1/launch"], ["GET", "/api/assignments/assignment%2F1/insights"],
      ["GET", "/api/assignments/assignment%2F1/students/student%2F1/insights"], ["POST", "/api/assignments/assignment%2F1/reconcile"],
    ]);
  });

  it("rejects redirects, cross-origin responses, oversized payloads, and non-JSON without leaking Bearer values", async () => {
    const getIdToken = vi.fn(async () => "private-token-value");
    const cases = [
      (() => { const value = response({ profile }); Object.defineProperty(value, "redirected", { value: true }); return value; })(),
      response({ profile }, 200, "https://evil.example/api/profile"),
      (() => { const value = response({ profile }); value.headers.set("content-length", "1048577"); return value; })(),
      (() => { const value = new Response("plain", { headers: { "content-type": "text/plain", "cache-control": "no-store" } }); Object.defineProperty(value, "url", { value: "https://dashboard.example/api/profile" }); return value; })(),
    ];
    for (const invalid of cases) {
      const api = createConnectedApi({ getIdToken, transport: async () => invalid, origin: "https://dashboard.example" });
      await expect(api.getProfile()).rejects.toBeInstanceOf(ConnectedApiError);
      try { await api.getProfile(); } catch (error) { expect(String(error)).not.toContain("private-token-value"); }
    }
  });
});
