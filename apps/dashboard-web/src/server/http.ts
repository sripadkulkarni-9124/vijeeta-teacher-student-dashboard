import { randomUUID } from "node:crypto";

import {
  ApiErrorSchema,
  DashboardProfileV2Schema,
  PaginationRequestSchema,
  VerifiedPrincipalSchema,
  type ConnectedDashboardRole,
  type DashboardProfileV2,
  type PaginationRequest,
  type VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import { DashboardStoreError } from "./dashboard-store";
import { TokenVerificationError, bearerToken } from "./profile-store";

const DEFAULT_MAXIMUM_JSON_BYTES = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PrincipalVerifier {
  verify(authorization: string): Promise<VerifiedPrincipal>;
}

export interface ProfileReader {
  getProfile(firebaseUid: string): Promise<DashboardProfileV2 | null>;
}

export interface ParseSchema<T> {
  parse(candidate: unknown): T;
}

export interface HttpContext {
  correlationId: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function authenticateRequest(
  request: Request,
  verifier: PrincipalVerifier,
): Promise<VerifiedPrincipal> {
  let authorization: string;
  try {
    authorization = bearerToken(request.headers.get("authorization"));
  } catch {
    throw new HttpError(401, "unauthorized", "Firebase authentication is required");
  }

  try {
    return VerifiedPrincipalSchema.parse(await verifier.verify(authorization));
  } catch (error) {
    if (error instanceof TokenVerificationError && error.status === 503) {
      throw new HttpError(503, "authentication_unavailable", "Authentication is temporarily unavailable", true);
    }
    throw new HttpError(401, "unauthorized", "Firebase authentication is required");
  }
}

export async function requireRole(
  principal: VerifiedPrincipal,
  role: ConnectedDashboardRole,
  profiles: ProfileReader,
): Promise<DashboardProfileV2> {
  const candidate = await profiles.getProfile(principal.uid);
  if (candidate === null) throw new HttpError(403, "forbidden", "This action is not permitted");
  const profile = DashboardProfileV2Schema.parse(candidate);
  if (profile.firebaseUid !== principal.uid) throw new Error("Persisted profile identity mismatch");
  if (profile.roles[role] !== "active") {
    throw new HttpError(403, "forbidden", "This action is not permitted");
  }
  return profile;
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ParseSchema<T>,
  options: { maximumBytes?: number } = {},
): Promise<T> {
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_JSON_BYTES;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "A JSON request body is required");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new HttpError(400, "invalid_request", "Request validation failed");
    }
    if (parsedLength > maximumBytes) {
      throw new HttpError(413, "payload_too_large", "Request body is too large");
    }
  }

  try {
    const serialized = await readBoundedBody(request, maximumBytes);
    return schema.parse(JSON.parse(serialized) as unknown);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
}

export function parsePagination(request: Request): PaginationRequest {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw new HttpError(400, "invalid_request", "Request validation failed");
    }
    if (query.getAll(key).length !== 1) {
      throw new HttpError(400, "invalid_request", "Request validation failed");
    }
  }
  const cursor = query.get("cursor") ?? undefined;
  const rawLimit = query.get("limit");
  if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) {
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
  try {
    return PaginationRequestSchema.parse({
      ...(cursor === undefined ? {} : { cursor }),
      ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    });
  } catch {
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
}

export function requireNoQuery(request: Request): void {
  if (new URL(request.url).search !== "") {
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
}

export function parseRouteId(candidate: unknown): string {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > 128
    || candidate !== candidate.trim()
    || candidate === "."
    || candidate === ".."
    || /^__.*__$/.test(candidate)
    || candidate.includes("/")
    || [...candidate].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    })) {
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
  return candidate;
}

export function jsonResponse(
  body: unknown,
  options: { status?: number; correlationId: string },
): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: sensitiveHeaders(options.correlationId),
  });
}

export async function serveHttp(
  request: Request,
  handler: (context: HttpContext) => Promise<Response>,
  options: { createCorrelationId?: () => string } = {},
): Promise<Response> {
  const correlationId = correlationIdFor(request, options.createCorrelationId ?? randomUUID);
  try {
    return await handler({ correlationId });
  } catch (error) {
    return safeErrorResponse(error, correlationId);
  }
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let serialized = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "payload_too_large", "Request body is too large");
    }
    serialized += decoder.decode(chunk.value, { stream: true });
  }
  serialized += decoder.decode();
  return serialized;
}

function correlationIdFor(request: Request, createCorrelationId: () => string): string {
  const supplied = request.headers.get("x-correlation-id");
  if (supplied !== null && UUID.test(supplied)) return supplied.toLowerCase();
  const created = createCorrelationId();
  if (!UUID.test(created)) throw new Error("Correlation ID generator returned an invalid UUID");
  return created.toLowerCase();
}

function sensitiveHeaders(correlationId: string): HeadersInit {
  return {
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
  };
}

function safeErrorResponse(error: unknown, correlationId: string): Response {
  const mapped = mapError(error);
  const body = ApiErrorSchema.parse({
    error: {
      code: mapped.code,
      message: mapped.message,
      correlationId,
      retryable: mapped.retryable,
    },
  });
  return Response.json(body, {
    status: mapped.status,
    headers: sensitiveHeaders(correlationId),
  });
}

function mapError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (!(error instanceof DashboardStoreError)) {
    return new HttpError(503, "service_unavailable", "The dashboard service is temporarily unavailable", true);
  }
  switch (error.code) {
    case "admin_required":
    case "active_teacher_required":
    case "bootstrap_identity_mismatch":
    case "classroom_forbidden":
    case "verified_email_required":
      return new HttpError(403, "forbidden", "This action is not permitted");
    case "profile_not_found":
      return new HttpError(404, "profile_not_found", "Target profile was not found");
    case "classroom_not_found":
      return new HttpError(404, "classroom_not_found", "Classroom was not found");
    case "invitation_not_found":
      return new HttpError(404, "invitation_not_found", "Invitation was not found");
    case "pagination_cursor_invalid":
    case "reason_required":
      return new HttpError(400, "invalid_request", "Request validation failed");
    case "profile_exists":
    case "teacher_transition_invalid":
    case "classroom_transition_invalid":
    case "invitation_transition_invalid":
      return new HttpError(409, "conflict", "The requested state transition is not available");
    case "email_index_collision":
    case "email_index_invalid":
    case "verified_email_changed":
      return new HttpError(409, "identity_conflict", "The verified identity cannot be used");
    case "invitation_identity_collision":
      return new HttpError(409, "conflict", "Invitation identity is unavailable");
    default:
      return new HttpError(503, "service_unavailable", "The dashboard service is temporarily unavailable", true);
  }
}
