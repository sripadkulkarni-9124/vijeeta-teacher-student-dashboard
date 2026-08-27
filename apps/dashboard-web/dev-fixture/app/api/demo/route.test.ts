import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardService } from "../../../../src/server/service";
import { DashboardStore } from "../../../../src/server/store";
import { createDemoServiceForTests, GET, POST } from "./route";

describe("/api/demo (development fixture entry)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves a local snapshot and dispatches local actions", async () => {
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
