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

export function createRevokeInvitationRouteHandler(dependencies: AdminRouteDependencies) {
  return (request: Request, routeContext: InvitationRouteContext) => serveHttp(request, async () => {
    await authorizeAdmin(request, dependencies);
    requireNoQuery(request);
    parseRouteId((await routeContext.params).id);
    await parseJsonBody(request, AdminReasonRequestSchema);
    throw new HttpError(
      501,
      "not_implemented",
      "Invitation revocation awaits server-side target resolution in Task 6",
    );
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: InvitationRouteContext): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createRevokeInvitationRouteHandler(dependencies)(request, context);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
