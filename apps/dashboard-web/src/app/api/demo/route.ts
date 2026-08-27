import { DashboardRoleSchema, parseDashboardAction, type DashboardProblem } from "@vijeeta/api-contracts";
import { DashboardService } from "../../../server/service";
import { DashboardStoreError } from "../../../server/store";

const defaultService = new DashboardService();

function activeService(): DashboardService {
  return (globalThis as { __vijeetaDashboardService?: DashboardService }).__vijeetaDashboardService ?? defaultService;
}

function problemResponse(problem: DashboardProblem, status: number): Response {
  return Response.json({ problem }, { status, headers: { "cache-control": "no-store" } });
}

function invalidRequest(error: unknown): Response {
  if (isValidationError(error)) {
    return problemResponse({
      code: "invalid_request",
      message: "Request validation failed",
      issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    }, 400);
  }
  return problemResponse({ code: "invalid_request", message: "Request validation failed" }, 400);
}

function isValidationError(error: unknown): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return typeof error === "object" && error !== null && Array.isArray((error as { issues?: unknown }).issues);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const role = DashboardRoleSchema.parse(new URL(request.url).searchParams.get("role"));
    return Response.json(await activeService().snapshot(role), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return invalidRequest(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseDashboardAction(await request.json());
    return Response.json(await activeService().dispatch(input), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (isValidationError(error) || error instanceof SyntaxError) return invalidRequest(error);
    if (error instanceof DashboardStoreError) return problemResponse({ code: "invalid_request", message: error.message }, error.code === "not_found" ? 404 : 409);
    return invalidRequest(error);
  }
}

export function createDemoServiceForTests(testService: DashboardService): void {
  // The route remains dependency-free in production while tests can inject an isolated store.
  (globalThis as { __vijeetaDashboardService?: DashboardService }).__vijeetaDashboardService = testService;
}
