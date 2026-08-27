import type { VerifiedPrincipal } from "@vijeeta/api-contracts";

import { getProductionDashboardRouteDependencies } from "../../../server/dashboard-runtime";
import {
  authenticateRequest,
  requireRole,
  serveHttp,
  type PrincipalVerifier,
  type ProfileReader,
} from "../../../server/http";

export interface AdminRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: ProfileReader;
  createCorrelationId?: () => string;
}

export async function authorizeAdmin(
  request: Request,
  dependencies: AdminRouteDependencies,
): Promise<VerifiedPrincipal> {
  const principal = await authenticateRequest(request, dependencies.verifier);
  await requireRole(principal, "admin", dependencies.profiles);
  return principal;
}

export async function productionAdminDependencies() {
  const dependencies = await getProductionDashboardRouteDependencies();
  return {
    verifier: dependencies.verifier,
    profiles: dependencies.store,
    admin: dependencies.store,
    classrooms: dependencies.store,
    audit: dependencies.store,
  };
}

export function productionDependencyError(request: Request, error: unknown): Promise<Response> {
  return serveHttp(request, async () => { throw error; });
}
