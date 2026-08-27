import { ClassroomListResponseSchema } from "@vijeeta/api-contracts";

import type { AdminClassroomRepository } from "../../../../server/dashboard-store";
import { jsonResponse, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

interface AdminClassroomsRouteDependencies extends AdminRouteDependencies {
  adminClassrooms: AdminClassroomRepository;
}

export function createAdminClassroomsRouteHandlers(dependencies: AdminClassroomsRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeAdmin(request, dependencies);
      const page = parsePagination(request);
      const result = await dependencies.adminClassrooms.listClassrooms(principal, page);
      const body = ClassroomListResponseSchema.parse({
        classrooms: result.items,
        nextCursor: result.nextCursor,
      });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createAdminClassroomsRouteHandlers(dependencies).GET(request);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
