import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardService } from "../../../server/service";
import { DashboardStore } from "../../../server/store";
import { createDemoServiceForTests, GET, POST } from "./route";

describe("/api/demo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable in the production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const getResponse = await GET(new Request("https://dashboard.example/api/demo?role=student"));
    const postResponse = await POST(new Request("https://dashboard.example/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invite-student", email: "blocked@example.com", classId: "class-1" }),
    }));

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
  });

  it("returns a typed 400 for an invalid role", async () => {
    const response = await GET(new Request("http://localhost/api/demo?role=admin"));
    expect(response.status).toBe(400);
    expect((await response.json()).problem.code).toBe("invalid_request");
  });

  it("returns a typed 400 for an invalid action", async () => {
    const response = await POST(new Request("http://localhost/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "unknown" }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).problem.code).toBe("invalid_request");
  });

  it("reports local store failures as typed 500 responses", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "vijeeta-route-error-"));
    createDemoServiceForTests(new DashboardService(new DashboardStore({ filePath: directoryPath })));

    const response = await GET(new Request("http://localhost/api/demo?role=student"));

    expect(response.status).toBe(500);
    expect((await response.json()).problem.code).toBe("internal_error");
  });

  it("serves a role snapshot and dispatches one typed action union", async () => {
    const statePath = join(await mkdtemp(join(tmpdir(), "vijeeta-route-")), "state.json");
    createDemoServiceForTests(new DashboardService(new DashboardStore({ filePath: statePath })));
    const created = await POST(new Request("http://localhost/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invite-student", email: "route@example.com", classId: "class-aurora-physics" }),
    }));
    expect(created.status).toBe(201);
    const snapshot = await GET(new Request("http://localhost/api/demo?role=teacher"));
    expect(snapshot.status).toBe(200);
    expect((await snapshot.json()).invites.at(-1).email).toBe("route@example.com");
  });
});
