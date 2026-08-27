import { describe, expect, it, vi } from "vitest";

import { V3AdapterError, V3AssignmentAdapter } from "./v3-assignment-adapter";

const token = "fresh.firebase.id-token";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function adapter(fetchImpl: (input: string, init: RequestInit) => Promise<Response>, extras: Record<string, unknown> = {}) {
  return new V3AssignmentAdapter({
    baseUrl: new URL("https://v3.example.test"),
    fetchImpl,
    ...extras,
  });
}

describe("V3AssignmentAdapter", () => {
  it("lists only V3-scoped owned jobs with exact pagination and Bearer forwarding", async () => {
    const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("https://v3.example.test/v3/paperdesk/jobs?page=2&page_size=25");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.credentials).toBe("omit");
      expect(init.headers).toEqual({ Authorization: `Bearer ${token}`, Accept: "application/json" });
      return json({
        jobs: [{ id: "JOB-1", title: "Mechanics", status: "final", by: "teacher@example.com", export: { answers: [] } }],
        page: 2, page_size: 25, total: 1, pages: 1,
      });
    });
    const result = await adapter(fetchImpl).listOwnedJobs({ page: 2, pageSize: 25 }, token);
    expect(result).toEqual({ jobs: [{ id: "JOB-1", title: "Mechanics", status: "final" }], page: 2, pageSize: 25, total: 1, pages: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("shares once with exact normalized recipients, epoch window, and solution mapping", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
      calls.push({ input, init });
      return json({
        ok: true,
        share: { id: "SH-1", test_id: "shared-job-1", token: "raw-secret", emails: ["student@example.com"], readout: { resolved: 1, batches: 0, warnings: ["ready"] } },
        no_email: [],
        link: "https://v3.example.test/t/opaque-capability",
        app_url: "https://example.invalid",
      });
    });
    const result = await adapter(fetchImpl).share({
      jobId: "JOB-1",
      recipientEmails: [" Student@Example.com ", "student@example.com"],
      openAt: "2026-08-28T00:00:00.000Z",
      closeAt: "2026-08-28T01:00:00.500Z",
      solutions: "after_close",
    }, token);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://v3.example.test/v3/paperdesk/jobs/JOB-1/share");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({ Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      emails: ["student@example.com"],
      window: { open: 1_787_875_200, close: 1_787_878_800.5 },
      solutions: "after_due",
    });
    expect(result).toEqual({
      shareId: "SH-1", testId: "shared-job-1", runnerPath: "/t/opaque-capability",
      readout: { resolved: 1, batches: 0, warnings: ["ready"] },
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(JSON.stringify(result)).not.toContain("student@example.com");
  });

  it.each([
    "../JOB", ".", "..", "JOB%2fother", "JOB%252fother", "JOB?key=x", "JOB#x", "JOB/other",
  ])("rejects unsafe job id %s before fetch", async (jobId) => {
    const fetchImpl = vi.fn();
    await expect(adapter(fetchImpl).share({
      jobId, recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never",
    }, token)).rejects.toMatchObject({ kind: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid or excessive recipients and never invokes the POST", async () => {
    const fetchImpl = vi.fn();
    const instance = adapter(fetchImpl);
    await expect(instance.share({ jobId: "JOB-1", recipientEmails: ["not-email"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token)).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(instance.share({ jobId: "JOB-1", recipientEmails: Array.from({ length: 501 }, (_, index) => `student${index}@example.com`), openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token)).rejects.toMatchObject({ kind: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a forged or header-injecting Bearer before any upstream call", async () => {
    const fetchImpl = vi.fn();
    await expect(adapter(fetchImpl).listOwnedJobs({ page: 1, pageSize: 50 }, "token\r\nCookie: stolen")).rejects.toMatchObject({ kind: "invalid_input", code: "invalid_bearer" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "http://v3.example.test",
    "https://user:pass@v3.example.test",
    "https://v3.example.test/path",
    "https://v3.example.test?key=x",
    "https://v3.example.test/#fragment",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://10.1.2.3",
    "https://service.internal",
  ])("rejects unsafe V3 base URL %s", (baseUrl) => {
    expect(() => new V3AssignmentAdapter({ baseUrl: new URL(baseUrl), fetchImpl: vi.fn() })).toThrow(V3AdapterError);
  });

  it.each([
    "//evil.example/t/token",
    "https://evil.example/t/token",
    "https://user@v3.example.test/t/token",
    "https://v3.example.test/t/token#fragment",
    "https://v3.example.test/t/%2e%2e/admin",
    "https://v3.example.test/v3/test/shared-job-1",
  ])("rejects unsafe runner link %s as an ambiguous share outcome", async (link) => {
    const instance = adapter(async () => json({ ok: true, share: { id: "SH-1", test_id: "shared-job-1", readout: { resolved: 1, batches: 0, warnings: [] } }, no_email: [], link, app_url: null }));
    await expect(instance.share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "on_submit" }, token)).rejects.toMatchObject({ kind: "ambiguous_outcome" });
  });

  it.each([400, 401, 403, 404, 409, 422])("maps validated %i to a definite rejection without exposing the body", async (status) => {
    const instance = adapter(async () => json({ error: `Bearer ${token} student@example.com` }, { status }));
    const error = await instance.share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token).catch((caught) => caught as V3AdapterError);
    expect(error).toMatchObject({ kind: "definite_rejection", status, retryable: false });
    expect(JSON.stringify(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain("student@example.com");
  });

  it.each([500, 502, 503, 307])("maps share status %i to an ambiguous outcome and never retries", async (status) => {
    const fetchImpl = vi.fn(async () => json({ error: "upstream" }, { status, headers: status === 307 ? { location: "https://evil.example" } : {} }));
    await expect(adapter(fetchImpl).share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token)).rejects.toMatchObject({ kind: "ambiguous_outcome", retryable: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats disconnect, wrong content type, malformed and oversized success as ambiguous without retry", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => { throw new Error(`disconnect Bearer ${token}`); },
      async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      async () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
      async () => json("unexpected scalar success"),
      async () => json({ ok: true, share: {} }),
      async () => json({ ok: true }, { headers: { "content-length": "1000" } }),
    ];
    for (const run of cases) {
      const fetchImpl = vi.fn(run);
      await expect(adapter(fetchImpl, { maxResponseBytes: 64 }).share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token)).rejects.toMatchObject({ kind: "ambiguous_outcome" });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("treats an explicitly unsuccessful 2xx share body as ambiguous", async () => {
    const fetchImpl = vi.fn(async () => json({
      ok: false,
      share: { id: "SH-1", test_id: "shared-job-1", readout: { resolved: 1, batches: 0, warnings: [] } },
      link: "https://v3.example.test/t/opaque-capability",
    }));
    await expect(adapter(fetchImpl).share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token)).rejects.toMatchObject({ kind: "ambiguous_outcome" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("aborts a timed-out share once and returns a redacted ambiguous outcome", async () => {
    const fetchImpl = vi.fn(async (_input: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException(`Bearer ${token}`, "AbortError")));
    }));
    const error = await adapter(fetchImpl, { timeoutMs: 5 }).share({ jobId: "JOB-1", recipientEmails: ["student@example.com"], openAt: "2026-08-28T00:00:00.000Z", closeAt: null, solutions: "never" }, token).catch((caught) => caught as V3AdapterError);
    expect(error).toMatchObject({ kind: "ambiguous_outcome", code: "timeout", retryable: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain(token);
  });
});
