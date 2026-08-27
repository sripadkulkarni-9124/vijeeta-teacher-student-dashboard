import { ClassroomResponseSchema } from "@vijeeta/api-contracts";

import type { PaginatedClassroomRepository } from "../../../../server/dashboard-store";
import { HttpError, jsonResponse, parseRouteId, requireNoQuery, serveHttp } from "../../../../server/http";
import { authorizeClassWorkspace, productionClassroomDependencies, type ClassroomRouteDependencies } from "../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Dependencies extends ClassroomRouteDependencies { classrooms: PaginatedClassroomRepository }

export function createClassroomDetailRouteHandler(dependencies: Dependencies) {
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authorizeClassWorkspace(request, dependencies);
    requireNoQuery(request);
    const classroomId = parseRouteId((await routeContext.params).id);
    const classroom = await dependencies.classrooms.getClassroom(principal, classroomId);
    if (classroom === null) throw new HttpError(404, "classroom_not_found", "Classroom was not found");
    return jsonResponse(ClassroomResponseSchema.parse({ classroom }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    return createClassroomDetailRouteHandler(await productionClassroomDependencies())(request, context);
  } catch (error) { return serveHttp(request, async () => { throw error; }); }
}
