import { AdminProfileListResponseSchema } from "@vijeeta/api-contracts";

import type { AdminRepository } from "../../../../server/dashboard-store";
import { jsonResponse, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

interface AdminProfilesRouteDependencies extends AdminRouteDependencies {
  admin: AdminRepository;
}

export function createAdminProfilesRouteHandlers(dependencies: AdminProfilesRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeAdmin(request, dependencies);
      const page = parsePagination(request);
      const result = await dependencies.admin.listProfiles(principal, page);
      const body = AdminProfileListResponseSchema.parse({
        profiles: result.items,
        nextCursor: result.nextCursor,
      });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createAdminProfilesRouteHandlers(dependencies).GET(request);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
