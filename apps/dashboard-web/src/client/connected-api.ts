import {
  AcceptInvitationResponseSchema,
  AdminAuditListResponseSchema,
  AdminInvitationListResponseSchema,
  AdminProfileListResponseSchema,
  ApiErrorSchema,
  AssignmentInsightsResponseSchema,
  AssignmentLaunchResponseSchema,
  ClassroomAssignmentListResponseSchema,
  ClassroomAssignmentResponseSchema,
  ClassroomInviteResponseSchema,
  ClassroomListResponseSchema,
  ClassroomResponseSchema,
  ClassroomRosterResponseSchema,
  DashboardProfileResponseSchema,
  InspectInvitationResponseSchema,
  type AdminReasonRequest,
  type CreateClassroomAssignmentRequest,
  type CreateClassroomRequest,
  type DashboardProfileOnboardRequest,
  type InviteClassroomMemberRequest,
  type ReconcileAssignmentRequest,
  type UpdateActiveRoleRequest,
} from "@vijeeta/api-contracts";

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Parser<T> = { parse(value: unknown): T };
type Pagination = { limit?: number; cursor?: string };
type RosterPagination = { limit?: number; memberCursor?: string; invitationCursor?: string };

const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 15_000;

export class ConnectedApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | undefined,
    readonly correlationId: string | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ConnectedApiError";
  }
}

export interface ConnectedApiOptions {
  getIdToken(forceRefresh: boolean): Promise<string>;
  transport?: Transport;
  origin?: string;
  timeoutMs?: number;
  onAuthorizationLost?: () => void;
}

function segment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) throw new ConnectedApiError("Invalid resource identifier", "invalid_request", undefined, undefined, false);
  return encodeURIComponent(trimmed);
}

function query(path: string, values: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) parameters.set(key, String(value));
  const encoded = parameters.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function safeOrigin(explicit?: string): string {
  const candidate = explicit ?? (typeof window === "undefined" ? "http://localhost" : window.location.origin);
  const parsed = new URL(candidate);
  if (parsed.origin !== candidate.replace(/\/$/, "")) throw new Error("Connected API origin must be an origin");
  return parsed.origin;
}

function validateResponseBoundary(response: Response, origin: string): void {
  if (response.redirected) throw invalidResponse("Redirected API responses are not accepted");
  let responseOrigin: string;
  try { responseOrigin = new URL(response.url).origin; } catch { throw invalidResponse("API response origin is unavailable"); }
  if (responseOrigin !== origin) throw invalidResponse("Cross-origin API responses are not accepted");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw invalidResponse("API response must be JSON");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw invalidResponse("API response is too large");
  if (!(response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store")) {
    throw invalidResponse("Sensitive API responses must not be cached");
  }
}

function invalidResponse(message: string): ConnectedApiError {
  return new ConnectedApiError(message, "invalid_response", undefined, undefined, false);
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw invalidResponse("API response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const chunk = await readWithAbort(reader, signal);
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw invalidResponse("API response is too large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw invalidResponse("API response was not valid UTF-8"); }
  try { return JSON.parse(text) as unknown; }
  catch { throw invalidResponse("API response was not valid JSON"); }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortError(): Error {
  return Object.assign(new Error("Request aborted"), { name: "AbortError" });
}

function parseProblem(value: unknown, status: number): ConnectedApiError {
  const parsed = ApiErrorSchema.safeParse(value);
  if (!parsed.success) return new ConnectedApiError("The request could not be completed", `http_${status}`, status, undefined, false);
  const problem = parsed.data.error;
  return new ConnectedApiError(problem.message, problem.code, status, problem.correlationId, problem.retryable);
}

export function createConnectedApi(options: ConnectedApiOptions) {
  const transport = options.transport ?? fetch;
  const origin = safeOrigin(options.origin);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function execute<T>(path: string, schema: Parser<T>, request: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const method = request.method ?? "GET";
    const safeRead = method === "GET";
    let forced = false;

    for (;;) {
      let token: string;
      try { token = await options.getIdToken(forced); }
      catch { throw new ConnectedApiError("Sign in to continue", "authentication_required", undefined, undefined, false); }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${token}` };
        if (request.body !== undefined) headers["content-type"] = "application/json";
        Object.assign(headers, request.headers ?? {});
        const response = await transport(path, {
          method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        validateResponseBoundary(response, origin);
        const payload = await readJson(response, controller.signal);
        if (response.status === 401 || response.status === 403) options.onAuthorizationLost?.();
        if (response.status === 401 && safeRead && !forced) { forced = true; continue; }
        if (!response.ok) throw parseProblem(payload, response.status);
        try { return schema.parse(payload); }
        catch { throw invalidResponse("API response did not match its contract"); }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new ConnectedApiError("The request timed out", "timeout", undefined, undefined, true);
        }
        if (error instanceof ConnectedApiError) throw error;
        throw new ConnectedApiError("The dashboard service is unavailable", "network_error", undefined, undefined, true);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const profile = (body: DashboardProfileOnboardRequest | UpdateActiveRoleRequest, path = "/api/profile") =>
    execute(path, DashboardProfileResponseSchema, { method: "POST", body }).then((value) => value.profile);
  const reason = <T,>(path: string, body: AdminReasonRequest, schema: Parser<T>) => execute(path, schema, { method: "POST", body });

  return {
    getProfile: () => execute("/api/profile", DashboardProfileResponseSchema).then((value) => value.profile),
    onboard: (role: DashboardProfileOnboardRequest["role"]) => profile({ role }),
    setActiveRole: (activeRole: UpdateActiveRoleRequest["activeRole"]) => profile({ activeRole }, "/api/profile/active-role"),

    listAdminProfiles: (page: Pagination = {}) => execute(query("/api/admin/profiles", page), AdminProfileListResponseSchema),
    approveTeacher: (uid: string, body: AdminReasonRequest) => reason(`/api/admin/teachers/${segment(uid)}/approve`, body, DashboardProfileResponseSchema),
    suspendTeacher: (uid: string, body: AdminReasonRequest) => reason(`/api/admin/teachers/${segment(uid)}/suspend`, body, DashboardProfileResponseSchema),
    listAdminClassrooms: (page: Pagination = {}) => execute(query("/api/admin/classrooms", page), ClassroomListResponseSchema),
    archiveAdminClassroom: (id: string, body: AdminReasonRequest) => reason(`/api/admin/classrooms/${segment(id)}/archive`, body, ClassroomResponseSchema),
    restoreAdminClassroom: (id: string, body: AdminReasonRequest) => reason(`/api/admin/classrooms/${segment(id)}/restore`, body, ClassroomResponseSchema),
    listAdminInvitations: (page: Pagination = {}) => execute(query("/api/admin/invitations", page), AdminInvitationListResponseSchema),
    revokeAdminInvitation: (id: string, body: AdminReasonRequest) => reason(`/api/admin/invitations/${segment(id)}/revoke`, body, ClassroomInviteResponseSchema),
    redeliverAdminInvitation: (id: string, body: AdminReasonRequest) => reason(`/api/admin/invitations/${segment(id)}/redeliver`, body, ClassroomInviteResponseSchema),
    listAdminAudit: (page: Pagination = {}) => execute(query("/api/admin/audit", page), AdminAuditListResponseSchema),

    listClasses: (page: Pagination = {}) => execute(query("/api/classes", page), ClassroomListResponseSchema),
    createClassroom: (body: CreateClassroomRequest) => execute("/api/classes", ClassroomResponseSchema, { method: "POST", body }),
    getClassroom: (id: string) => execute(`/api/classes/${segment(id)}`, ClassroomResponseSchema),
    archiveClassroom: (id: string, body: AdminReasonRequest) => execute(`/api/classes/${segment(id)}/archive`, ClassroomResponseSchema, { method: "POST", body }),
    getClassroomRoster: (id: string, page: RosterPagination = {}) => execute(query(`/api/classes/${segment(id)}/members`, page), ClassroomRosterResponseSchema),
    inviteClassroomMember: (id: string, body: InviteClassroomMemberRequest) => execute(`/api/classes/${segment(id)}/members`, ClassroomInviteResponseSchema, { method: "POST", body }),
    revokeClassroomInvitation: (classId: string, inviteId: string, body: AdminReasonRequest) => execute(`/api/classes/${segment(classId)}/invitations/${segment(inviteId)}/revoke`, ClassroomInviteResponseSchema, { method: "POST", body }),
    redeliverClassroomInvitation: (classId: string, inviteId: string, body: AdminReasonRequest) => execute(`/api/classes/${segment(classId)}/invitations/${segment(inviteId)}/redeliver`, ClassroomInviteResponseSchema, { method: "POST", body }),

    inspectInvitation: (token: string) => execute("/api/invitations/inspect", InspectInvitationResponseSchema, { method: "POST", body: { token } }),
    acceptInvitation: (token: string) => execute("/api/invitations/accept", AcceptInvitationResponseSchema, { method: "POST", body: { token } }),

    listAssignments: (classId: string, page: Pagination = {}) => execute(query(`/api/classes/${segment(classId)}/assignments`, page), ClassroomAssignmentListResponseSchema),
    createAssignment: (classId: string, body: CreateClassroomAssignmentRequest, idempotencyKey: string) => execute(`/api/classes/${segment(classId)}/assignments`, ClassroomAssignmentResponseSchema, { method: "POST", body, headers: { "idempotency-key": idempotencyKey } }),
    launchAssignment: (id: string) => execute(`/api/assignments/${segment(id)}/launch`, AssignmentLaunchResponseSchema),
    getAssignmentInsights: (id: string) => execute(`/api/assignments/${segment(id)}/insights`, AssignmentInsightsResponseSchema),
    getStudentAssignmentInsights: (id: string, uid: string) => execute(`/api/assignments/${segment(id)}/students/${segment(uid)}/insights`, AssignmentInsightsResponseSchema),
    reconcileAssignment: (id: string, body: ReconcileAssignmentRequest) => execute(`/api/assignments/${segment(id)}/reconcile`, ClassroomAssignmentResponseSchema, { method: "POST", body }),
  };
}

export type ConnectedApi = ReturnType<typeof createConnectedApi>;
