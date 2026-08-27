import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardService } from "./service";
import { DashboardStore } from "./store";

describe("DashboardService", () => {
  it("returns simulated role sessions and role-specific insights", async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), "vijeeta-service-")), "state.json");
    const service = new DashboardService(new DashboardStore({ filePath }));
    const teacher = await service.snapshot("teacher");
    const student = await service.snapshot("student");

    expect(teacher.role).toBe("teacher");
    expect(teacher.session.role).toBe("teacher");
    expect(student.role).toBe("student");
    expect(student.insights.personal.score).toBeTypeOf("number");
  });
});
