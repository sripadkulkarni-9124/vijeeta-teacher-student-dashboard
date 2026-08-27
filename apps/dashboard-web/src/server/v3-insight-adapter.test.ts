import { describe, expect, it, vi } from "vitest";

import { V3InsightAdapter } from "./v3-insight-adapter";

const token = "fresh.firebase.id-token";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}

function adapter(fetchImpl: (input: string, init: RequestInit) => Promise<Response>, extras: Record<string, unknown> = {}) {
  return new V3InsightAdapter({ baseUrl: new URL("https://v3.example.test"), fetchImpl, ...extras });
}

describe("V3InsightAdapter", () => {
  it("uses only exact owner results and strips emails, pending lists, and raw fields", async () => {
    const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("https://v3.example.test/v3/paperdesk/shares/SH-1/results");
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({ Authorization: `Bearer ${token}`, Accept: "application/json" });
      return json({
        share: { id: "SH-1", test_id: "shared-job-1", by: "teacher@example.com", token: "secret" },
        funnel: { shared: 2, attempted: 1, pending: 1 },
        batch: { mean: 42, median: 42, top: 42, bottom: 42 },
        students: [
          { email: "student@example.com", uid: "student-1", attempted: true, score: 42, max: 100, accuracy: 0.5, time_ms: 1200, takeaways: ["private"] },
          { email: "pending@example.com", attempted: false },
        ],
        pending_emails: ["pending@example.com"], heatmap: { Mechanics: { n: 1, acc: 0.5 } },
      });
    });
    const result = await adapter(fetchImpl).shareResults("SH-1", token);
    expect(result).toEqual({
      shareId: "SH-1", testId: "shared-job-1", funnel: { shared: 2, attempted: 1, pending: 1 }, averageScore: 42,
      students: [
        { uid: "student-1", attempted: true, score: 42, maxScore: 100, accuracy: 0.5, timeMs: 1200 },
        { uid: null, attempted: false, score: null, maxScore: null, accuracy: null, timeMs: null },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("@example.com");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects owner results whose returned share id mismatches the requested route", async () => {
    const instance = adapter(async () => json({
      share: { id: "SH-OTHER", test_id: "shared-job-1" },
      funnel: { shared: 0, attempted: 0, pending: 0 },
      batch: {}, students: [],
    }));
    await expect(instance.shareResults("SH-1", token)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("binds the exact snapshotted Student UID into the individual analysis path", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      expect(input).toBe("https://v3.example.test/v3/paperdesk/shares/SH-1/student/firebase-uid-1/analysis");
      return json({ test_id: "shared-job-1", title: "Mechanics", score: 42, max: 100, percentile: { percentile: 80, label: "Strong", raw: "drop" }, delta_last: 5, answers: [{ qid: "q1" }], per_q: [{ answer: 2 }] });
    });
    const result = await adapter(fetchImpl).studentAnalysis("SH-1", "firebase-uid-1", token);
    expect(result).toEqual({ uid: "firebase-uid-1", testId: "shared-job-1", available: true, title: "Mechanics", score: 42, maxScore: 100, percentile: 80, deltaFromPrevious: 5 });
    expect(JSON.stringify(result)).not.toContain("answers");
  });

  it.each([
    { share_id: "SH-OTHER", user_id: "firebase-uid-1" },
    { share_id: "SH-1", user_id: "firebase-uid-other" },
  ])("rejects individual analysis identity mismatch %o", async (identity) => {
    const instance = adapter(async () => json({
      ...identity,
      test_id: "shared-job-1", title: "Mechanics", score: 42, max: 100,
      percentile: { percentile: 80 }, delta_last: 5,
    }));
    await expect(instance.studentAnalysis("SH-1", "firebase-uid-1", token)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it.each([
    { method: "test", responseId: "shared-other" },
    { method: "review", responseId: "shared-other" },
    { method: "analysis", responseId: "shared-other" },
  ])("rejects Student $method response whose test id mismatches the route", async ({ method, responseId }) => {
    const instance = adapter(async () => method === "test"
      ? json({ test_id: responseId, title: "Mechanics", kind: "main", duration_min: 180, sections: [] })
      : method === "review"
        ? json({ test_id: responseId, score: 42, max: 100, review: [] })
        : json({ test_id: responseId, title: "Mechanics", score: 42, max: 100, percentile: { percentile: 80 }, delta_last: 5 }));
    const call = method === "test"
      ? instance.studentTest("shared-job-1", "firebase-uid-1", token)
      : method === "review"
        ? instance.studentReview("shared-job-1", "firebase-uid-1", token)
        : instance.studentTestAnalysis("shared-job-1", "firebase-uid-1", token);
    await expect(call).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("binds every self-scoped user_id query to the trusted UID", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      seen.push(input);
      if (input.includes("/v3/test/attempts")) return json({ attempts: [{ test_id: "shared-job-1", title: "Mechanics", score: 42, max: 100, ts: "2026-08-28T00:00:00.000Z", per_q: [{ answer: 2 }] }] });
      if (input.includes("/review")) return json({ test_id: "shared-job-1", score: 42, max: 100, review: [{ correct_answer: 2 }], solutions_hidden: "until the test closes" });
      if (input.includes("/v3/test/") && input.includes("/analysis")) return json({ test_id: "shared-job-1", title: "Mechanics", score: 42, max: 100, percentile: { percentile: 80 }, delta_last: 5, answers: [{ answer: 2 }] });
      return json({ available: false, message: "Take a test", weak_areas: [{ answer: "drop" }] });
    });
    const instance = adapter(fetchImpl);
    await instance.studentAttempts("firebase-uid-1", token);
    await instance.studentReview("shared-job-1", "firebase-uid-1", token);
    await instance.studentTestAnalysis("shared-job-1", "firebase-uid-1", token);
    await instance.studentOverall("firebase-uid-1", token);
    expect(seen).toEqual([
      "https://v3.example.test/v3/test/attempts?user_id=firebase-uid-1",
      "https://v3.example.test/v3/test/shared-job-1/review?user_id=firebase-uid-1",
      "https://v3.example.test/v3/test/shared-job-1/analysis?user_id=firebase-uid-1",
      "https://v3.example.test/v3/analysis/overall?user_id=firebase-uid-1",
    ]);
  });

  it("projects Student list, safe runner launch, and test metadata without answers", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/v3/shared/tests")) return json({
        tests: [{ test_id: "shared-job-1", title: "Mechanics", teacher: "teacher@example.com", kind: "main", shared: 1_777_507_200, state: "open", score: null, max: null, web_path: "/t/opaque-capability", emails: ["private@example.com"] }],
        by_teacher: {}, empty: null,
      });
      return json({ test_id: "shared-job-1", title: "Mechanics", kind: "main", duration_min: 180, sections: [{ code: "PHY", questions: [{ answer: 2 }] }], questions: [{ answer: 2 }], window: { open: 1_777_507_200, close: null } });
    });
    const instance = adapter(fetchImpl);
    const tests = await instance.studentTests("firebase-uid-1", token);
    expect(tests.tests[0]).toEqual({ testId: "shared-job-1", title: "Mechanics", teacherLabel: "teacher", kind: "main", sharedAtEpochSeconds: 1_777_507_200, state: "open", score: null, maxScore: null, runnerPath: "/t/opaque-capability" });
    expect(await instance.studentLaunch("shared-job-1", "firebase-uid-1", token)).toEqual({ testId: "shared-job-1", runnerPath: "/t/opaque-capability" });
    expect(await instance.studentTest("shared-job-1", "firebase-uid-1", token)).toEqual({ testId: "shared-job-1", title: "Mechanics", kind: "main", durationMinutes: 180, sectionCount: 1, window: { open: 1_777_507_200, close: null } });
  });

  it.each(["test-list", "test-detail", "attempt-row"])("rejects a mismatched Student UID echoed by $method", async (method) => {
    const instance = adapter(async () => {
      if (method === "test-list") return json({
        tests: [{ test_id: "shared-job-1", user_id: "firebase-uid-other", title: "Mechanics", teacher: "teacher@example.com", kind: "main", shared: 1_777_507_200, state: "open", score: null, max: null }],
        by_teacher: {}, empty: null,
      });
      if (method === "test-detail") return json({ test_id: "shared-job-1", user_id: "firebase-uid-other", title: "Mechanics", kind: "main", duration_min: 180, sections: [] });
      return json({ attempts: [{ test_id: "shared-job-1", user_id: "firebase-uid-other", title: "Mechanics", score: 42, max: 100, ts: "2026-08-28T00:00:00.000Z" }] });
    });
    const call = method === "test-list"
      ? instance.studentTests("firebase-uid-1", token)
      : method === "test-detail"
        ? instance.studentTest("shared-job-1", "firebase-uid-1", token)
        : instance.studentAttempts("firebase-uid-1", token);
    await expect(call).rejects.toMatchObject({ kind: "unavailable" });
  });

  it.each(["../SH", "SH%2fother", "SH?key=x", ".", ".."])("rejects unsafe share id %s before fetch", async (shareId) => {
    const fetchImpl = vi.fn();
    await expect(adapter(fetchImpl).shareResults(shareId, token)).rejects.toMatchObject({ kind: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps read redirect, 5xx, wrong content type, oversized body, and malformed success to unavailable", async () => {
    const responses = [
      new Response(null, { status: 307, headers: { location: "https://evil.example" } }),
      json({ error: "backend" }, { status: 500 }),
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      json({ share: {} }, { headers: { "content-length": "1000" } }),
      json([]),
      json({ share: {} }),
    ];
    for (const response of responses) {
      await expect(adapter(async () => response, { maxResponseBytes: 64 }).shareResults("SH-1", token)).rejects.toMatchObject({ kind: "unavailable" });
    }
  });

  it("does not expose a generic arbitrary-path method", () => {
    const instance = adapter(vi.fn());
    expect(instance).not.toHaveProperty("get");
    expect(instance).not.toHaveProperty("request");
  });
});
