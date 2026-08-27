import {
  V3OwnedJobsSchema,
  V3ScheduleTimestampSchema,
  V3ShareResultSchema,
  type AssignmentSolutions,
  type V3OwnedJobs,
  type V3ShareResult,
} from "@vijeeta/api-contracts";

export type V3Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type V3AdapterErrorKind = "invalid_input" | "definite_rejection" | "ambiguous_outcome" | "unavailable";

export class V3AdapterError extends Error {
  constructor(
    readonly kind: V3AdapterErrorKind,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(kind === "definite_rejection" ? "V3 rejected the request" : kind === "invalid_input" ? "Invalid V3 request" : "V3 response unavailable");
    this.name = "V3AdapterError";
  }
}

export interface V3AdapterOptions {
  baseUrl: URL;
  fetchImpl: V3Fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  createAbortController?: () => AbortController;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export interface V3ShareInput {
  jobId: string;
  recipientEmails: readonly string[];
  openAt: string;
  closeAt: string | null;
  solutions: AssignmentSolutions;
}

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RECIPIENTS = 500;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{20,8192}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFINITE_REJECTION = new Set([400, 401, 403, 404, 409, 422]);

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || a >= 224;
}

function ipv6Hextets(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const pieces = part.split(":");
    if (pieces.some((piece) => !/^[0-9a-f]{1,4}$/i.test(piece))) return null;
    return pieces.map((piece) => Number.parseInt(piece, 16));
  };
  const left = parse(halves[0] ?? "");
  const right = parse(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array.from({ length: missing }, () => 0), ...right] : null;
}

function unsafeIpv6(hostname: string): boolean {
  const address = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!address.includes(":")) return false;
  const words = ipv6Hextets(address);
  if (!words) return true;
  const first = words[0] ?? 0;
  const unspecified = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (unspecified || loopback) return true;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    const ipv4 = `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    return privateIpv4(ipv4);
  }
  return false;
}

export function validateV3Origin(value: URL): URL {
  const url = new URL(value.toString());
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const unsafeHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host.endsWith(".internal") || host === "::1" || host === "[::1]" || host.startsWith("fe80:")
    || host === "0.0.0.0" || privateIpv4(host) || unsafeIpv6(host);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.pathname !== "/" || url.search || url.hash || unsafeHost) {
    throw new V3AdapterError("invalid_input", "invalid_v3_origin", false);
  }
  return new URL(url.origin);
}

export function validateV3Id(value: string, label = "identifier"): string {
  if (!SAFE_ID.test(value) || value === "." || value === ".." || value.includes("%")) {
    throw new V3AdapterError("invalid_input", `invalid_${label}`, false);
  }
  return value;
}

function validateBearer(token: string): string {
  if (!SAFE_TOKEN.test(token)) throw new V3AdapterError("invalid_input", "invalid_bearer", false);
  return token;
}

function normalizedEmails(values: readonly string[]): string[] {
  if (values.length === 0 || values.length > MAX_RECIPIENTS) throw new V3AdapterError("invalid_input", "invalid_recipients", false);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) throw new V3AdapterError("invalid_input", "invalid_recipients", false);
    if (!seen.has(email)) { seen.add(email); result.push(email); }
  }
  if (result.length === 0) throw new V3AdapterError("invalid_input", "invalid_recipients", false);
  return result;
}

function epochSeconds(value: string, label: string): number {
  const parsed = V3ScheduleTimestampSchema.safeParse(value);
  if (!parsed.success) throw new V3AdapterError("invalid_input", `invalid_${label}`, false);
  return Date.parse(parsed.data) / 1000;
}

export function validateRunnerPath(value: unknown, origin: URL): string {
  if (typeof value !== "string" || value.length > 1024 || value.includes("%")) {
    throw new V3AdapterError("invalid_input", "invalid_runner_link", false);
  }
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new V3AdapterError("invalid_input", "invalid_runner_link", false); }
  if (url.origin !== origin.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || !/^\/t\/[A-Za-z0-9_-]{16,256}$/.test(url.pathname)) {
    throw new V3AdapterError("invalid_input", "invalid_runner_link", false);
  }
  return url.pathname;
}

type OutcomeMode = "read" | "write";

export class V3Transport {
  readonly origin: URL;
  private readonly fetchImpl: V3Fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly createAbortController: () => AbortController;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;

  constructor(options: V3AdapterOptions) {
    this.origin = validateV3Origin(options.baseUrl);
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 1), 15_000);
    this.maxResponseBytes = Math.min(Math.max(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, 1), MAX_RESPONSE_BYTES);
    this.createAbortController = options.createAbortController ?? (() => new AbortController());
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  }

  async json(path: string, method: "GET" | "POST", token: string, body: unknown, mode: OutcomeMode): Promise<unknown> {
    const target = new URL(path, this.origin);
    if (target.origin !== this.origin.origin || target.pathname !== path.split("?", 1)[0]) {
      throw new V3AdapterError("invalid_input", "invalid_v3_path", false);
    }
    const bearer = validateBearer(token);
    const controller = this.createAbortController();
    let timedOut = false;
    const timer = this.setTimeoutImpl(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: "application/json" };
      if (method === "POST") headers["Content-Type"] = "application/json";
      const response = await this.fetchImpl(target.toString(), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "manual",
        credentials: "omit",
      });
      if (response.status >= 300 && response.status < 400) throw this.outcome(mode, "redirect", response.status);
      if (!response.ok) {
        if (DEFINITE_REJECTION.has(response.status)) throw new V3AdapterError("definite_rejection", `v3_${response.status}`, false, response.status);
        throw this.outcome(mode, "upstream_status", response.status);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") throw this.outcome(mode, "wrong_content_type");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.maxResponseBytes)) throw this.outcome(mode, "oversized_response");
      const bytes = await this.readBounded(response, mode);
      if (bytes.byteLength === 0) throw this.outcome(mode, "empty_response");
      try { return JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw this.outcome(mode, "malformed_response"); }
    } catch (error) {
      if (error instanceof V3AdapterError) throw error;
      throw this.outcome(mode, timedOut ? "timeout" : "disconnect");
    } finally {
      this.clearTimeoutImpl(timer);
    }
  }

  private outcome(mode: OutcomeMode, code: string, status?: number): V3AdapterError {
    return new V3AdapterError(mode === "write" ? "ambiguous_outcome" : "unavailable", code, false, status);
  }

  private async readBounded(response: Response, mode: OutcomeMode): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
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
          throw this.outcome(mode, "oversized_response");
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V3AdapterError("invalid_input", "malformed_projection", false);
  return value as Record<string, unknown>;
}

export class V3AssignmentAdapter {
  private readonly transport: V3Transport;

  constructor(options: V3AdapterOptions) { this.transport = new V3Transport(options); }

  async listOwnedJobs(input: { page: number; pageSize: number }, bearer: string): Promise<V3OwnedJobs> {
    if (!Number.isInteger(input.page) || input.page < 1 || input.page > 1_000_000 || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50) {
      throw new V3AdapterError("invalid_input", "invalid_pagination", false);
    }
    const rawPayload = await this.transport.json(`/v3/paperdesk/jobs?page=${input.page}&page_size=${input.pageSize}`, "GET", bearer, undefined, "read");
    try {
      const payload = record(rawPayload);
      const jobs = Array.isArray(payload.jobs) ? payload.jobs.map((raw) => {
        const job = record(raw);
        return { id: job.id, title: job.title, status: job.status, ...(job.grade !== undefined ? { grade: job.grade } : {}), ...(job.created !== undefined && job.created !== null ? { createdAt: job.created } : {}), ...(job.updated !== undefined && job.updated !== null ? { updatedAt: job.updated } : {}) };
      }) : payload.jobs;
      const projected = V3OwnedJobsSchema.parse({ jobs, page: payload.page, pageSize: payload.page_size, total: payload.total, pages: payload.pages });
      if (projected.page !== input.page || projected.pageSize !== input.pageSize) throw new Error("pagination mismatch");
      return projected;
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }

  async share(input: V3ShareInput, bearer: string): Promise<V3ShareResult> {
    const jobId = validateV3Id(input.jobId, "job_id");
    const open = epochSeconds(input.openAt, "open_time");
    const close = input.closeAt === null ? null : epochSeconds(input.closeAt, "close_time");
    if (close !== null && close <= open) throw new V3AdapterError("invalid_input", "invalid_window", false);
    const solutions = input.solutions === "never" ? "never" : input.solutions === "on_submit" ? "after_submit" : "after_due";
    const rawPayload = await this.transport.json(`/v3/paperdesk/jobs/${jobId}/share`, "POST", bearer, {
      emails: normalizedEmails(input.recipientEmails),
      window: { open, close },
      solutions,
    }, "write");
    try {
      const payload = record(rawPayload);
      if (payload.ok !== true) throw new V3AdapterError("invalid_input", "malformed_projection", false);
      const share = record(payload.share);
      if (share.job_id !== jobId) throw new V3AdapterError("invalid_input", "mismatched_job_id", false);
      const readout = record(share.readout);
      const warnings = Array.isArray(readout.warnings) ? readout.warnings.slice(0, 20) : [];
      return V3ShareResultSchema.parse({
        shareId: share.id,
        testId: share.test_id,
        runnerPath: validateRunnerPath(payload.link, this.transport.origin),
        readout: { resolved: readout.resolved, batches: readout.batches, warnings },
      });
    } catch (error) {
      if (error instanceof V3AdapterError && error.kind !== "invalid_input") throw error;
      throw new V3AdapterError("ambiguous_outcome", "malformed_response", false);
    }
  }
}
