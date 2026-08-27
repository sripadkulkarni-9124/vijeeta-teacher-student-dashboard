import { afterEach, describe, expect, it } from "vitest";
import { configureProfileForTests, createTeacherEligibility, GET, POST, resetProfileForTests } from "./route";
import { InMemoryProfileStore, TokenVerificationError } from "../../../server/profile-store";

afterEach(() => { resetProfileForTests(); });

describe("profile routes", () => {
  it("checks teacher authority only through the allowlisted PaperDesk config read", async () => {
    const reads: Array<{ path: string; authorization: string; query: URLSearchParams }> = [];
    const eligibility = createTeacherEligibility({
      read: async (input) => { reads.push(input); return Response.json({ creator: true, role: "teacher" }); },
    });

    await expect(eligibility.verify("Bearer verified-token")).resolves.toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      path: "/v3/paperdesk/config",
      query: expect.any(URLSearchParams),
      authorization: "Bearer verified-token",
    });
    expect(reads[0].query.toString()).toBe("");

    await expect(createTeacherEligibility({ read: async () => new Response(null, { status: 403 }) }).verify("Bearer denied")).resolves.toBe(false);
    await expect(createTeacherEligibility({ read: async () => new Response(null, { status: 502 }) }).verify("Bearer unavailable")).rejects.toThrow("unavailable");
  });

  it("does not treat an authoritative 200 response as teacher authority without creator true", async () => {
    const cases = [
      Response.json({ creator: false, role: "reviewer" }),
      Response.json({ role: "reviewer", analytics: true }),
      Response.json({ creator: "true" }),
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ creator: true }), { status: 200, headers: { "content-type": "text/plain" } }),
    ];

    for (const upstream of cases) {
      await expect(createTeacherEligibility({ read: async () => upstream }).verify("Bearer token")).resolves.toBe(false);
    }
    await expect(createTeacherEligibility({
      read: async () => new Response(JSON.stringify({ creator: true, padding: "x".repeat(65_536) }), { status: 200, headers: { "content-type": "application/json" } }),
    }).verify("Bearer token")).resolves.toBe(false);
  });

  it("binds first-login onboarding to the verified token UID", async () => {
    const profiles = new InMemoryProfileStore();
    configureProfileForTests({
      profiles,
      verifier: { verify: async () => ({ uid: "verified-uid" }) },
      teacherEligibility: { verify: async () => true },
    });
    const response = await POST(new Request("http://localhost/api/profile/onboard", { method: "POST", headers: { authorization: "Bearer real", "content-type": "application/json" }, body: JSON.stringify({ role: "teacher", firebaseUid: "forged" }) }));
    expect(response.status).toBe(400);
    const created = await POST(new Request("http://localhost/api/profile/onboard", { method: "POST", headers: { authorization: "Bearer real", "content-type": "application/json" }, body: JSON.stringify({ role: "teacher" }) }));
    expect(created.status).toBe(201);
    expect((await created.json()).firebaseUid).toBe("verified-uid");
    const read = await GET(new Request("http://localhost/api/profile", { headers: { authorization: "Bearer real" } }));
    expect(read.status).toBe(200);
  });

  it("requires authoritative PaperDesk eligibility before teacher onboarding", async () => {
    const profiles = new InMemoryProfileStore();
    const checked: string[] = [];
    configureProfileForTests({
      profiles,
      verifier: { verify: async () => ({ uid: "verified-teacher" }) },
      teacherEligibility: { verify: async (authorization) => { checked.push(authorization); return false; } },
    });

    const response = await POST(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { authorization: "Bearer verified-token", "content-type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    }));

    expect(response.status).toBe(403);
    expect(checked).toEqual(["Bearer verified-token"]);
    expect(await profiles.getByFirebaseUid("verified-teacher")).toBeNull();
  });

  it("allows student onboarding without granting or probing teacher authority", async () => {
    const profiles = new InMemoryProfileStore();
    let teacherChecks = 0;
    configureProfileForTests({
      profiles,
      verifier: { verify: async () => ({ uid: "verified-student" }) },
      teacherEligibility: { verify: async () => { teacherChecks += 1; return false; } },
    });

    const response = await POST(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { authorization: "Bearer student-token", "content-type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    }));

    expect(response.status).toBe(201);
    expect(teacherChecks).toBe(0);
    expect((await response.json()).allowedRoles).toEqual(["student"]);
  });

  it("fails teacher onboarding with 503 when the authority check is unavailable", async () => {
    const profiles = new InMemoryProfileStore();
    configureProfileForTests({
      profiles,
      verifier: { verify: async () => ({ uid: "verified-teacher" }) },
      teacherEligibility: { verify: async () => { throw new Error("V3 unavailable"); } },
    });
    const response = await POST(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { authorization: "Bearer teacher-token", "content-type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    }));
    expect(response.status).toBe(503);
    expect(await profiles.getByFirebaseUid("verified-teacher")).toBeNull();
  });

  it("returns 401 when Firebase rejects the ID token", async () => {
    configureProfileForTests({
      profiles: new InMemoryProfileStore(),
      verifier: { verify: async () => { throw new TokenVerificationError("invalid", 401); } },
    });
    const response = await GET(new Request("http://localhost/api/profile", { headers: { authorization: "Bearer invalid" } }));
    expect(response.status).toBe(401);
  });

  it("returns 503 when production dependencies are missing or persistence fails", async () => {
    resetProfileForTests();
    const missing = await GET(new Request("http://localhost/api/profile", { headers: { authorization: "Bearer token" } }));
    expect(missing.status).toBe(503);

    configureProfileForTests({
      profiles: {
        getByFirebaseUid: async () => { throw new Error("firestore unavailable"); },
        onboard: async () => { throw new Error("firestore unavailable"); },
      },
      verifier: { verify: async () => ({ uid: "verified-uid" }) },
    });
    const failedRead = await GET(new Request("http://localhost/api/profile", { headers: { authorization: "Bearer token" } }));
    const failedWrite = await POST(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    }));
    expect(failedRead.status).toBe(503);
    expect(failedWrite.status).toBe(503);
  });
});
