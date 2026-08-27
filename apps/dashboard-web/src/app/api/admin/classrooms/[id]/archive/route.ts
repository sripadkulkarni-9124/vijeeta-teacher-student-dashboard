import { AdminReasonRequestSchema, ClassroomResponseSchema } from "@vijeeta/api-contracts";

import type { ClassroomRepository } from "../../../../../../server/dashboard-store";
import {
  jsonResponse,
  parseJsonBody,
  parseRouteId,
  requireNoQuery,
  serveHttp,
} from "../../../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../../../route-support";

interface ArchiveClassroomRouteDependencies extends AdminRouteDependencies {
  classrooms: ClassroomRepository;
  now?: () => string;
}

interface ClassroomRouteContext {
  params: Promise<{ id: string }>;
}

export function createArchiveClassroomRouteHandler(dependencies: ArchiveClassroomRouteDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: ClassroomRouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authorizeAdmin(request, dependencies);
    requireNoQuery(request);
    const classroomId = parseRouteId((await routeContext.params).id);
    const { reason } = await parseJsonBody(request, AdminReasonRequestSchema);
    const classroom = await dependencies.classrooms.archive(principal, classroomId, {
      now: now(), correlationId, reason,
    });
    return jsonResponse(ClassroomResponseSchema.parse({ classroom }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: ClassroomRouteContext): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createArchiveClassroomRouteHandler(dependencies)(request, context);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
