import { describe, expect, it, vi } from "vitest";

import { createDemoApi } from "./demo-api";

const teacherSnapshot = {
  role: "teacher" as const,
  session: {
    role: "teacher" as const,
    userId: "teacher-1",
    displayName: "Meera Shah",
    organisationId: "org-1",
  },
  organisation: { id: "org-1", name: "Aurora Academy" },
  classes: [],
  invites: [],
  quickTests: [],
  assignments: [],
  insights: {
    aggregate: { attempted: 0, pending: 0, averageScore: 0 },
    individual: [],
  },
};

describe("demo API client", () => {
  it("loads and validates the selected role snapshot over local HTTP", async () => {
    const transport = vi.fn(async () =>
      new Response(JSON.stringify(teacherSnapshot), {
        headers: { "content-type": "application/json" },
      }),
    );
    const api = createDemoApi(transport);

    await expect(api.snapshot("teacher")).resolves.toEqual(teacherSnapshot);
    expect(transport).toHaveBeenCalledWith("/api/demo?role=teacher", {
      cache: "no-store",
    });
  });

  it("posts typed mutations and surfaces API problems", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "student-invited", invite: {} }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ problem: { code: "invalid_request", message: "Bad input" } }),
          { status: 400 },
        ),
      );
    const api = createDemoApi(transport);
    const input = {
      type: "invite-student" as const,
      email: "new@example.test",
      classId: "class-1",
    };

    await api.mutate(input);
    expect(transport).toHaveBeenNthCalledWith(1, "/api/demo", {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(api.mutate(input)).rejects.toThrow("Bad input");
  });
});
