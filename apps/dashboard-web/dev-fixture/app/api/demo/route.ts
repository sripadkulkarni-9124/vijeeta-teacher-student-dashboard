import { DashboardRoleSchema, parseDashboardAction, type DashboardProblem } from "@vijeeta/api-contracts";
import { DashboardService } from "../../../../src/server/service";
import { DashboardStoreError } from "../../../../src/server/store";

let defaultService: DashboardService | undefined;

function activeService(): DashboardService {
  const injected = (globalThis as { __vijeetaDashboardService?: DashboardService }).__vijeetaDashboardService;
  if (injected) return injected;
  defaultService ??= new DashboardService();
  return defaultService;
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

function internalError(): Response {
  return problemResponse({
    code: "internal_error",
    message: "The local dashboard store could not complete the request",
  }, 500);
}

function isValidationError(error: unknown): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return typeof error === "object" && error !== null && Array.isArray((error as { issues?: unknown }).issues);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const role = DashboardRoleSchema.parse(new URL(request.url).searchParams.get("role"));
    return Response.json(await activeService().snapshot(role), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return isValidationError(error) ? invalidRequest(error) : internalError();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseDashboardAction(await request.json());
    return Response.json(await activeService().dispatch(input), { status: 201 });
  } catch (error) {
    if (isValidationError(error) || error instanceof SyntaxError) return invalidRequest(error);
    if (error instanceof DashboardStoreError) return problemResponse({ code: "invalid_request", message: error.message }, error.code === "not_found" ? 404 : 409);
    return internalError();
  }
}

export function createDemoServiceForTests(testService: DashboardService): void {
  (globalThis as { __vijeetaDashboardService?: DashboardService }).__vijeetaDashboardService = testService;
}
