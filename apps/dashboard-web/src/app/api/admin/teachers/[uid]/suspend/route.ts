import {
  AdminReasonRequestSchema,
  DashboardProfileResponseSchema,
} from "@vijeeta/api-contracts";

import type { AdminRepository } from "../../../../../../server/dashboard-store";
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

interface SuspendTeacherRouteDependencies extends AdminRouteDependencies {
  admin: AdminRepository;
  now?: () => string;
}

interface TeacherRouteContext {
  params: Promise<{ uid: string }>;
}

export function createSuspendTeacherRouteHandler(dependencies: SuspendTeacherRouteDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: TeacherRouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authorizeAdmin(request, dependencies);
    requireNoQuery(request);
    const targetUid = parseRouteId((await routeContext.params).uid);
    const { reason } = await parseJsonBody(request, AdminReasonRequestSchema);
    const profile = await dependencies.admin.suspendTeacher(principal, targetUid, {
      now: now(),
      correlationId,
      reason,
    });
    return jsonResponse(DashboardProfileResponseSchema.parse({ profile }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: TeacherRouteContext): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createSuspendTeacherRouteHandler(dependencies)(request, context);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
