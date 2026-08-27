import { sanitizeError } from "./redaction";

export interface V3ReadInput { path: string; query: URLSearchParams; authorization: string; }
export type V3Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export const V3_MAX_RESPONSE_BYTES = 1_048_576;
export interface V3ReadAdapterOptions { baseUrl: URL; timeoutMs?: number; maxResponseBytes?: number; fetchImpl?: V3Fetch; logger?: (message: string) => void; }

export class V3ReadAdapter {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: V3Fetch;
  private readonly logger?: (message: string) => void;

  constructor(options: V3ReadAdapterOptions) {
    this.baseUrl = new URL(options.baseUrl.toString());
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/$/, "")}/`;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5000, 250), 15000);
    this.maxResponseBytes = Math.min(Math.max(options.maxResponseBytes ?? V3_MAX_RESPONSE_BYTES, 1), V3_MAX_RESPONSE_BYTES);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.logger = options.logger;
  }

  async read(input: V3ReadInput): Promise<Response> {
    const target = new URL(input.path.replace(/^\//, ""), this.baseUrl);
    target.search = input.query.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const upstream = await this.fetchImpl(target.toString(), { method: "GET", headers: { authorization: input.authorization }, signal: controller.signal });
      if (!upstream.ok) {
        const safeStatus = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
        const code = upstream.status === 401 ? "unauthorized" : upstream.status === 403 ? "forbidden" : upstream.status === 404 ? "not_found" : "upstream_unavailable";
        return Response.json({ problem: { code, message: "V3 request failed" } }, { status: safeStatus, headers: { "cache-control": "no-store" } });
      }
      const contentType = upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") return this.failure();
      const contentLength = upstream.headers.get("content-length");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > this.maxResponseBytes)) return this.failure();
      const body = await this.readBoundedBody(upstream);
      try { JSON.parse(new TextDecoder().decode(body)); } catch { return this.failure(); }
      const headers = new Headers();
      if (contentType) headers.set("content-type", contentType);
      headers.set("cache-control", "no-store");
      return new Response(body, { status: upstream.status, headers });
    } catch (error) {
      const safe = sanitizeError(error);
      this.logger?.(`v3 upstream failure: ${safe}`);
      return Response.json({ problem: { code: "upstream_unavailable", message: "V3 service unavailable" } }, { status: 502, headers: { "cache-control": "no-store" } });
    } finally { clearTimeout(timer); }
  }

  private failure(): Response {
    return Response.json({ problem: { code: "upstream_unavailable", message: "V3 response unavailable" } }, { status: 502, headers: { "cache-control": "no-store" } });
  }

  private async readBoundedBody(response: Response): Promise<ArrayBuffer> {
    if (!response.body) return new ArrayBuffer(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > this.maxResponseBytes) {
          await reader.cancel();
          throw new Error("V3 response exceeded the size limit");
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  }
}
