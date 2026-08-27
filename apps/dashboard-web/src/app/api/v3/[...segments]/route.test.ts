import { afterEach, describe, expect, it } from "vitest";
import { configureV3ForTests, GET, resetV3ForTests } from "./route";
import { InMemoryProfileStore } from "../../../../server/profile-store";

afterEach(() => { resetV3ForTests(); });

describe("V3 read-only BFF route", () => {
  it("requires a bearer Firebase token", async () => {
    const response = await GET(new Request("http://localhost/api/v3/shared/mode"), { params: Promise.resolve({ segments: ["shared", "mode"] }) });
    expect(response.status).toBe(401);
  });

  it("blocks capability-bearing shared-web enter and resolve paths", async () => {
    const enter = await GET(new Request("http://localhost/api/v3/shared-web/enter/token", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared-web", "enter", "token"] }) });
    const resolve = await GET(new Request("http://localhost/api/v3/shared-web/resolve/token", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared-web", "resolve", "token"] }) });
    expect(enter.status).toBe(400);
    expect(resolve.status).toBe(400);
  });

  it("blocks PaperDesk share result paths without dashboard membership", async () => {
    const results = await GET(new Request("http://localhost/api/v3/paperdesk/shares/sid/results", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["paperdesk", "shares", "sid", "results"] }) });
    const studentAnalysis = await GET(new Request("http://localhost/api/v3/paperdesk/shares/sid/student/uid/analysis", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["paperdesk", "shares", "sid", "student", "uid", "analysis"] }) });
    expect(results.status).toBe(400);
    expect(studentAnalysis.status).toBe(400);
  });

  it("enforces verified profile role/path permissions", async () => {
    const profiles = new InMemoryProfileStore();
    await profiles.onboard("student-uid", "student");
    configureV3ForTests({ profiles, verifier: { verify: async () => ({ uid: "student-uid" }) }, adapter: { read: async () => new Response("ok") } });
    const response = await GET(new Request("http://localhost/api/v3/paperdesk/jobs", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["paperdesk", "jobs"] }) });
    expect(response.status).toBe(403);
  });

  it("rejects a profile that is not bound to the verified Firebase UID", async () => {
    const profiles = new InMemoryProfileStore({ profiles: [{
      internalProfileId: "p1", firebaseUid: "other-uid", allowedRoles: ["teacher"], activeRole: "teacher", onboardingCompleted: true,
      createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    }] });
    configureV3ForTests({ profiles, verifier: { verify: async () => ({ uid: "verified-uid" }) }, adapter: { read: async () => new Response("unexpected") } });
    const response = await GET(new Request("http://localhost/api/v3/shared/mode", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared", "mode"] }) });
    expect(response.status).toBe(403);
  });

  it("rejects a malformed profile even when a lookup implementation returns it", async () => {
    configureV3ForTests({
      profiles: {
        getByFirebaseUid: async () => ({ internalProfileId: "p1", firebaseUid: "other-uid", allowedRoles: ["student"], activeRole: "student", onboardingCompleted: true, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }),
        onboard: async () => { throw new Error("not used"); },
      },
      verifier: { verify: async () => ({ uid: "verified-uid" }) },
      adapter: { read: async () => new Response("unexpected") },
    });
    const response = await GET(new Request("http://localhost/api/v3/shared/mode", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared", "mode"] }) });
    expect(response.status).toBe(403);
  });

  it("keeps student and teacher route surfaces isolated", async () => {
    const studentProfiles = new InMemoryProfileStore();
    await studentProfiles.onboard("student-uid", "student");
    configureV3ForTests({ profiles: studentProfiles, verifier: { verify: async () => ({ uid: "student-uid" }) }, adapter: { read: async () => new Response("ok") } });
    const studentTeacherRoute = await GET(new Request("http://localhost/api/v3/paperdesk/config", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["paperdesk", "config"] }) });
    expect(studentTeacherRoute.status).toBe(403);

    const teacherProfiles = new InMemoryProfileStore();
    await teacherProfiles.onboard("teacher-uid", "teacher");
    configureV3ForTests({ profiles: teacherProfiles, verifier: { verify: async () => ({ uid: "teacher-uid" }) }, adapter: { read: async () => new Response("ok") } });
    const teacherStudentRoute = await GET(new Request("http://localhost/api/v3/shared/tests", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared", "tests"] }) });
    expect(teacherStudentRoute.status).toBe(403);
  });

  it("rejects a student review or analysis request for another Firebase UID", async () => {
    const profiles = new InMemoryProfileStore();
    await profiles.onboard("student-uid", "student");
    configureV3ForTests({
      profiles,
      verifier: { verify: async () => ({ uid: "student-uid" }) },
      adapter: { read: async () => new Response("unexpected") },
    });

    for (const leaf of ["review", "analysis"]) {
      const response = await GET(
        new Request(`http://localhost/api/v3/test/test-1/${leaf}?user_id=other-uid`, {
          headers: { authorization: "Bearer real" },
        }),
        { params: Promise.resolve({ segments: ["test", "test-1", leaf] }) },
      );
      expect(response.status).toBe(403);
    }
  });

  it("returns 503 when production verifier/profile dependencies are not configured", async () => {
    resetV3ForTests();
    const response = await GET(new Request("http://localhost/api/v3/shared/mode", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared", "mode"] }) });
    expect(response.status).toBe(503);
  });

  it("rejects an injected verifier that does not return a canonical UID", async () => {
    configureV3ForTests({
      profiles: new InMemoryProfileStore(),
      verifier: { verify: async () => ({ uid: "" }) },
      adapter: { read: async () => new Response("unexpected") },
    });
    const response = await GET(new Request("http://localhost/api/v3/shared/mode", { headers: { authorization: "Bearer real" } }), { params: Promise.resolve({ segments: ["shared", "mode"] }) });
    expect(response.status).toBe(401);
  });
});
