import { AdminAuditListResponseSchema } from "@vijeeta/api-contracts";

import type { AuditRepository } from "../../../../server/dashboard-store";
import { jsonResponse, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

interface AdminAuditRouteDependencies extends AdminRouteDependencies {
  audit: AuditRepository;
}

export function createAdminAuditRouteHandlers(dependencies: AdminAuditRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeAdmin(request, dependencies);
      const page = parsePagination(request);
      const result = await dependencies.audit.listAuditEvents(principal, page);
      const body = AdminAuditListResponseSchema.parse({
        events: result.items,
        nextCursor: result.nextCursor,
      });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createAdminAuditRouteHandlers(dependencies).GET(request);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
