import { ClassroomListResponseSchema, ClassroomResponseSchema, CreateClassroomRequestSchema } from "@vijeeta/api-contracts";

import type { PaginatedClassroomRepository } from "../../../server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, parsePagination, requireNoQuery, requireRole, serveHttp } from "../../../server/http";
import { authorizeClassWorkspace, productionClassroomDependencies, type ClassroomRouteDependencies } from "./route-support";

interface Dependencies extends ClassroomRouteDependencies { classrooms: PaginatedClassroomRepository; now?: () => string }

export function createClassesRouteHandlers(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeClassWorkspace(request, dependencies);
      const page = await dependencies.classrooms.listForPrincipalPage(principal, parsePagination(request));
      return jsonResponse(ClassroomListResponseSchema.parse({ classrooms: page.items, nextCursor: page.nextCursor }), { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
    POST: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      await requireRole(principal, "teacher", dependencies.profiles);
      requireNoQuery(request);
      const input = await parseJsonBody(request, CreateClassroomRequestSchema);
      const classroom = await dependencies.classrooms.create(principal, input, { now: now(), correlationId });
      return jsonResponse(ClassroomResponseSchema.parse({ classroom }), { status: 201, correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  return serveProduction(request, "GET");
}
export async function POST(request: Request): Promise<Response> {
  return serveProduction(request, "POST");
}
async function serveProduction(request: Request, method: "GET" | "POST"): Promise<Response> {
  try {
    const dependencies = await productionClassroomDependencies();
    return createClassesRouteHandlers(dependencies)[method](request);
  } catch (error) { return serveHttp(request, async () => { throw error; }); }
}
