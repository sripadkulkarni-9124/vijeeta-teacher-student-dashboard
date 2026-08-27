import { AdminInvitationListResponseSchema } from "@vijeeta/api-contracts";

import type { AdminInvitationRepository } from "../../../../server/dashboard-store";
import { jsonResponse, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  projectInvitation,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

interface AdminInvitationsRouteDependencies extends AdminRouteDependencies {
  invitations: AdminInvitationRepository;
}

export function createAdminInvitationsRouteHandlers(dependencies: AdminInvitationsRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeAdmin(request, dependencies);
      const page = parsePagination(request);
      const result = await dependencies.invitations.listInvitations(principal, page);
      const body = AdminInvitationListResponseSchema.parse({
        invitations: result.items.map(projectInvitation),
        nextCursor: result.nextCursor,
      });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createAdminInvitationsRouteHandlers(dependencies).GET(request);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
