import { AdminReasonRequestSchema, ClassroomResponseSchema } from "@vijeeta/api-contracts";

import type { PaginatedClassroomRepository } from "@/server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, parseRouteId, requireNoQuery, requireRole, serveHttp } from "@/server/http";
import { productionClassroomDependencies, type ClassroomRouteDependencies } from "../../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Dependencies extends ClassroomRouteDependencies { classrooms: PaginatedClassroomRepository; now?: () => string }

export function createTeacherArchiveClassroomRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    await requireRole(principal, "teacher", dependencies.profiles);
    requireNoQuery(request);
    const classroomId = parseRouteId((await routeContext.params).id);
    const input = await parseJsonBody(request, AdminReasonRequestSchema);
    const classroom = await dependencies.classrooms.archive(principal, classroomId, { now: now(), correlationId, reason: input.reason });
    return jsonResponse(ClassroomResponseSchema.parse({ classroom }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try { return createTeacherArchiveClassroomRouteHandler(await productionClassroomDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
