import { describe, expect, it, vi } from "vitest";
import { V3ReadAdapter } from "./v3-read-adapter";

describe("V3ReadAdapter", () => {
  it("forwards only the Firebase bearer header to an allowlisted GET", async () => {
    const upstream = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://v3.example.test/v3/shared/mode");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ authorization: "Bearer firebase-token" });
      return new Response(JSON.stringify({ focused: false }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const adapter = new V3ReadAdapter({ baseUrl: new URL("https://v3.example.test"), fetchImpl: upstream });
    const response = await adapter.read({ path: "/v3/shared/mode", query: new URLSearchParams(), authorization: "Bearer firebase-token" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sanitizes upstream failures", async () => {
    const adapter = new V3ReadAdapter({ baseUrl: new URL("https://v3.example.test"), fetchImpl: vi.fn(async () => { throw new Error("Bearer firebase-token leaked"); }) });
    const response = await adapter.read({ path: "/v3/shared/mode", query: new URLSearchParams(), authorization: "Bearer firebase-token" });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("firebase-token");
  });

  it("does not forward an upstream error body", async () => {
    const adapter = new V3ReadAdapter({ baseUrl: new URL("https://v3.example.test"), fetchImpl: async () => new Response("backend stack Bearer secret", { status: 500 }) });
    const response = await adapter.read({ path: "/v3/shared/mode", query: new URLSearchParams(), authorization: "Bearer firebase-token" });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("backend stack");
  });
});
