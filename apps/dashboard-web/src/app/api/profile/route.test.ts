import { afterEach, describe, expect, it } from "vitest";
import { configureProfileForTests, GET, POST, resetProfileForTests } from "./route";
import { InMemoryProfileStore, TokenVerificationError } from "../../../server/profile-store";

afterEach(() => { resetProfileForTests(); });

describe("profile routes", () => {
  it("binds first-login onboarding to the verified token UID", async () => {
    const profiles = new InMemoryProfileStore();
    configureProfileForTests({ profiles, verifier: { verify: async () => ({ uid: "verified-uid" }) } });
    const response = await POST(new Request("http://localhost/api/profile/onboard", { method: "POST", headers: { authorization: "Bearer real", "content-type": "application/json" }, body: JSON.stringify({ role: "teacher", firebaseUid: "forged" }) }));
    expect(response.status).toBe(400);
    const created = await POST(new Request("http://localhost/api/profile/onboard", { method: "POST", headers: { authorization: "Bearer real", "content-type": "application/json" }, body: JSON.stringify({ role: "teacher" }) }));
    expect(created.status).toBe(201);
    expect((await created.json()).firebaseUid).toBe("verified-uid");
    const read = await GET(new Request("http://localhost/api/profile", { headers: { authorization: "Bearer real" } }));
    expect(read.status).toBe(200);
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
