import { AdminReasonRequestSchema, ClassroomInviteResponseSchema } from "@vijeeta/api-contracts";

import type { AdminInvitationRepository } from "../../../../../../server/dashboard-store";
import {
  jsonResponse,
  parseJsonBody,
  parseRouteId,
  requireNoQuery,
  serveHttp,
} from "../../../../../../server/http";
import {
  authorizeAdmin,
  projectInvitation,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../../../route-support";

interface InvitationRouteContext {
  params: Promise<{ id: string }>;
}

interface RevokeInvitationRouteDependencies extends AdminRouteDependencies {
  invitations: AdminInvitationRepository;
  now?: () => string;
}

export function createRevokeInvitationRouteHandler(dependencies: RevokeInvitationRouteDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: InvitationRouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authorizeAdmin(request, dependencies);
    requireNoQuery(request);
    const id = parseRouteId((await routeContext.params).id);
    const input = await parseJsonBody(request, AdminReasonRequestSchema);
    const invitation = await dependencies.invitations.revokeInvitationById(principal, id, {
      now: now(), correlationId, reason: input.reason,
    });
    const body = ClassroomInviteResponseSchema.parse({ invite: projectInvitation(invitation) });
    return jsonResponse(body, { correlationId });
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
