import { HttpError, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

export function createAdminInvitationsRouteHandlers(dependencies: AdminRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async () => {
      await authorizeAdmin(request, dependencies);
      parsePagination(request);
      throw new HttpError(
        501,
        "not_implemented",
        "Invitation administration awaits the Task 6 store implementation",
      );
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
