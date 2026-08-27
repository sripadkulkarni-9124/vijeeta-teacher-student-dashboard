import { AdminReasonRequestSchema } from "@vijeeta/api-contracts";

import {
  HttpError,
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

interface InvitationRouteContext {
  params: Promise<{ id: string }>;
}

export function createRedeliverInvitationRouteHandler(dependencies: AdminRouteDependencies) {
  return (request: Request, routeContext: InvitationRouteContext) => serveHttp(request, async () => {
    await authorizeAdmin(request, dependencies);
    requireNoQuery(request);
    parseRouteId((await routeContext.params).id);
    await parseJsonBody(request, AdminReasonRequestSchema);
    throw new HttpError(
      501,
      "not_implemented",
      "Invitation redelivery awaits token rotation and delivery persistence in Task 6",
    );
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: InvitationRouteContext): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createRedeliverInvitationRouteHandler(dependencies)(request, context);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
