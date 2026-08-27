import { z } from "zod";
import { DashboardRoleSchema } from "./dashboard";

export const V3_READ_PATHS = [
  "/v3/shared/mode",
  "/v3/shared/tests",
  "/v3/analysis/tests",
  "/v3/analysis/overall",
  "/v3/analysis/pyq",
  "/v3/paperdesk/config",
  "/v3/paperdesk/jobs",
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
  const [a, b] = segments;
  const params: Record<string, string> = {};
  let path: V3ReadPath;
  let allowed: readonly string[] = [];
  let required: readonly string[] = [];

  if (a === "shared" && (b === "mode" || b === "tests") && segments.length === 2) {
    path = `/v3/shared/${b}` as V3ReadPath;
  } else if (a === "analysis" && segments.length === 2 && (b === "tests" || b === "overall" || b === "pyq")) {
    path = `/v3/analysis/${b}` as V3ReadPath; allowed = ["user_id"]; required = ["user_id"];
  } else if (a === "paperdesk" && b === "config" && segments.length === 2) {
    path = "/v3/paperdesk/config";
  } else if (a === "paperdesk" && b === "jobs" && segments.length === 2) {
    path = "/v3/paperdesk/jobs"; allowed = ["page", "page_size"];
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

const V3SharedTestCardSchema = z.object({
  test_id: z.string().min(1), title: z.string().min(1), teacher: z.string().min(1), kind: z.string().min(1),
  shared: z.number().finite(), state: z.string().min(1), score: z.number().finite().nullable(), max: z.number().finite().nullable(),
}).strip();

export const V3SharedModeResponseSchema = z.object({
  audience: z.boolean(), focused: z.boolean(), teachers: z.array(z.string()), n_tests: z.number().int().nonnegative(),
}).strip();
export const V3SharedTestsResponseSchema = z.object({
  tests: z.array(V3SharedTestCardSchema), by_teacher: z.record(z.string(), z.array(V3SharedTestCardSchema)), empty: z.string().nullable(),
}).strip();
export const V3AnalysisTestsResponseSchema = z.object({
  tests: z.array(z.object({
    test_id: z.string().min(1), title: z.string().nullable(), type: z.string().min(1), exam: z.string().nullable(), score: z.number().finite(), max: z.number().finite(), pct: z.number().finite(), ts: z.string().nullable(), is_pyq: z.boolean(), analyzable: z.boolean(), percentile: z.number().finite().optional(), chapter: z.string().optional(),
  }).strip()), count: z.number().int().nonnegative(),
}).strip();

const V3ReadinessSchema = z.object({ marks: z.number().finite(), of: z.number().finite(), percentile: z.number().finite().nullable().optional(), note: z.string().optional() }).strip();
const V3GrowthSchema = z.object({ available: z.boolean(), message: z.string().optional(), slope_pct_per_test: z.number().finite().optional(), slope_marks_per_test: z.number().finite().optional(), verdict: z.string().optional(), delta_last: z.number().finite().optional(), spark: z.array(z.number().finite()).optional(), spark_marks: z.array(z.number().finite()).optional() }).strip();
export const V3AnalysisOverallResponseSchema = z.object({
  available: z.boolean(), message: z.string().optional(), n: z.number().int().nonnegative().optional(), has_mock: z.boolean().optional(), provisional: z.boolean().optional(), readiness: V3ReadinessSchema.optional(), weighted_mean: V3ReadinessSchema.optional(), growth: V3GrowthSchema.optional(), per_subject: z.array(z.object({ subject: z.string(), subject_name: z.string().optional(), slope: z.number().finite().optional(), verdict: z.string().optional(), from: z.number().finite().optional(), to: z.number().finite().optional() }).strip()).optional(), streak: z.number().int().nonnegative().optional(),
}).strip();
export const V3AnalysisPyqResponseSchema = z.object({
  cards: z.array(z.object({ exam: z.string(), label: z.string(), papers: z.number().int().nonnegative(), avg_pct: z.number().finite(), best_pct: z.number().finite(), per_subject: z.array(z.object({ subject: z.string(), accuracy: z.number().finite().nullable() }).strip()), paper_list: z.array(z.object({ test_id: z.string(), title: z.string().nullable(), score: z.number().finite(), max: z.number().finite(), pct: z.number().finite(), ts: z.string().nullable() }).strip()) }).strip()), isolated: z.boolean(),
}).strip();
export const V3PaperdeskConfigResponseSchema = z.object({ admin: z.boolean(), creator: z.boolean(), role: z.string() }).strip();
const V3PaperdeskJobSchema = z.object({ id: z.string().min(1), title: z.string().min(1), status: z.string().min(1), grade: z.union([z.string(), z.number()]).optional(), created: z.union([z.string(), z.number()]).nullable().optional(), updated: z.union([z.string(), z.number()]).nullable().optional(), n_versions: z.number().int().nonnegative().optional(), kind: z.string().optional() }).strip();
export const V3PaperdeskJobsResponseSchema = z.object({ jobs: z.array(V3PaperdeskJobSchema), page: z.number().int().positive(), page_size: z.number().int().positive().max(50), total: z.number().int().nonnegative(), pages: z.number().int().nonnegative() }).strip();

export class V3ProjectionError extends Error {
  constructor(message: string) { super(message); this.name = "V3ProjectionError"; }
}

export function projectV3Response(path: V3ReadPath, input: unknown): unknown {
  const schema = path === "/v3/shared/mode" ? V3SharedModeResponseSchema
    : path === "/v3/shared/tests" ? V3SharedTestsResponseSchema
      : path === "/v3/analysis/tests" ? V3AnalysisTestsResponseSchema
        : path === "/v3/analysis/overall" ? V3AnalysisOverallResponseSchema
          : path === "/v3/analysis/pyq" ? V3AnalysisPyqResponseSchema
            : path === "/v3/paperdesk/config" ? V3PaperdeskConfigResponseSchema
              : path === "/v3/paperdesk/jobs" ? V3PaperdeskJobsResponseSchema
                : null;
  if (!schema) throw new V3ProjectionError("Unsupported V3 response projection");
  const result = schema.safeParse(input);
  if (!result.success) throw new V3ProjectionError("Malformed V3 response");
  return result.data;
}

export const HealthResponseSchema = z.object({ status: z.string(), build: z.string(), mode: z.string() }).strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
