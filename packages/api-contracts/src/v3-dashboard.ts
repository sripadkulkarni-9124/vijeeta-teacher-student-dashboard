import { z } from "zod";
import { DashboardRoleSchema } from "./dashboard";

export const V3_READ_PATHS = [
  "/v3/shared/mode",
  "/v3/shared/tests",
  "/v3/test/{id}",
  "/v3/test/{id}/review",
  "/v3/test/{id}/analysis",
  "/v3/analysis/tests",
  "/v3/analysis/overall",
  "/v3/analysis/pyq",
  "/v3/paperdesk/config",
  "/v3/paperdesk/jobs",
  "/v3/paperdesk/jobs/{id}",
] as const;

export type V3ReadPath = (typeof V3_READ_PATHS)[number];

export interface V3ReadRoute {
  path: V3ReadPath;
  params: Readonly<Record<string, string>>;
  query: URLSearchParams;
}

export class V3RouteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V3RouteValidationError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/;

function requiredId(value: string | undefined, label: string): string {
  if (!value || !ID.test(value)) throw new V3RouteValidationError(`Invalid ${label}`);
  return value;
}

function queryValue(query: URLSearchParams, name: string, required = false): string | undefined {
  const values = query.getAll(name);
  if (values.length > 1) throw new V3RouteValidationError(`Duplicate query parameter: ${name}`);
  if (required && (!values[0] || !ID.test(values[0]))) throw new V3RouteValidationError(`Missing or invalid query parameter: ${name}`);
  if (values[0] !== undefined && values[0] !== "" && !ID.test(values[0])) throw new V3RouteValidationError(`Invalid query parameter: ${name}`);
  return values[0];
}

function queryFor(query: URLSearchParams, allowed: readonly string[], required: readonly string[] = []): URLSearchParams {
  for (const key of query.keys()) if (!allowed.includes(key)) throw new V3RouteValidationError(`Unsupported query parameter: ${key}`);
  const result = new URLSearchParams();
  for (const key of allowed) {
    const value = queryValue(query, key, required.includes(key));
    if (value !== undefined && value !== "") result.set(key, value);
  }
  if (allowed.includes("page") && result.has("page") && (!/^\d+$/.test(result.get("page")!) || Number(result.get("page")) < 1)) throw new V3RouteValidationError("Invalid page");
  if (allowed.includes("page_size") && result.has("page_size") && (!/^\d+$/.test(result.get("page_size")!) || Number(result.get("page_size")) < 1 || Number(result.get("page_size")) > 50)) throw new V3RouteValidationError("Invalid page_size");
  return result;
}

export function parseV3ReadRoute(rawSegments: readonly string[], query: URLSearchParams): V3ReadRoute {
  const segments = rawSegments[0] === "v3" ? rawSegments.slice(1) : rawSegments;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/"))) throw new V3RouteValidationError("Invalid path");
  const [a, b, c] = segments;
  const params: Record<string, string> = {};
  let path: V3ReadPath;
  let allowed: readonly string[] = [];
  let required: readonly string[] = [];

  if (a === "shared" && (b === "mode" || b === "tests") && segments.length === 2) {
    path = `/v3/shared/${b}` as V3ReadPath;
  } else if (a === "test" && segments.length >= 2 && (b === "" || b === undefined)) {
    throw new V3RouteValidationError("Invalid test id");
  } else if (a === "test" && segments.length === 2) {
    params.id = requiredId(b, "test id"); path = "/v3/test/{id}";
  } else if (a === "test" && segments.length === 3 && (c === "review" || c === "analysis")) {
    params.id = requiredId(b, "test id"); path = `/v3/test/{id}/${c}` as V3ReadPath; allowed = ["user_id"]; required = ["user_id"];
  } else if (a === "analysis" && segments.length === 2 && (b === "tests" || b === "overall" || b === "pyq")) {
    path = `/v3/analysis/${b}` as V3ReadPath; allowed = ["user_id"]; required = ["user_id"];
  } else if (a === "paperdesk" && b === "config" && segments.length === 2) {
    path = "/v3/paperdesk/config";
  } else if (a === "paperdesk" && b === "jobs" && segments.length === 2) {
    path = "/v3/paperdesk/jobs"; allowed = ["page", "page_size"];
  } else if (a === "paperdesk" && b === "jobs" && segments.length === 3) {
    params.id = requiredId(c, "job id"); path = "/v3/paperdesk/jobs/{id}";
  } else {
    throw new V3RouteValidationError("Unsupported V3 read path");
  }
  return { path, params, query: queryFor(query, allowed, required) };
}

export const DashboardProfileSchema = z.object({
  internalProfileId: z.string().min(1),
  firebaseUid: z.string().min(1),
  allowedRoles: z.array(DashboardRoleSchema).min(1),
  activeRole: DashboardRoleSchema,
  onboardingCompleted: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().refine((profile) => profile.allowedRoles.includes(profile.activeRole), { message: "activeRole must be allowed", path: ["activeRole"] });
export type DashboardProfile = z.infer<typeof DashboardProfileSchema>;

export const ProfileOnboardRequestSchema = z.object({ role: DashboardRoleSchema }).strict();
export type ProfileOnboardRequest = z.infer<typeof ProfileOnboardRequestSchema>;

export const V3ProblemSchema = z.object({
  code: z.enum(["invalid_request", "unauthorized", "forbidden", "not_found", "upstream_unavailable", "internal_error"]),
  message: z.string().min(1),
}).strict();
export type V3Problem = z.infer<typeof V3ProblemSchema>;

export const HealthResponseSchema = z.object({ status: z.string(), build: z.string(), mode: z.string() }).strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
