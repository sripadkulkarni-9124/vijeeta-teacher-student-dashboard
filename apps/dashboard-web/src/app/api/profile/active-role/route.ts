import { DashboardProfileResponseSchema, UpdateActiveRoleRequestSchema } from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../../server/dashboard-store";
import { getProductionDashboardRouteDependencies } from "../../../../server/dashboard-runtime";
import {
  authenticateRequest,
  jsonResponse,
  parseJsonBody,
  requireNoQuery,
  serveHttp,
  type PrincipalVerifier,
} from "../../../../server/http";

interface ActiveRoleRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: ProfileRepository;
  now?: () => string;
  createCorrelationId?: () => string;
}

export function createActiveRoleRouteHandler(dependencies: ActiveRoleRouteDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    requireNoQuery(request);
    const input = await parseJsonBody(request, UpdateActiveRoleRequestSchema);
    const profile = await dependencies.profiles.setActiveRole(principal, input.activeRole, { now: now(), correlationId });
    return jsonResponse(DashboardProfileResponseSchema.parse({ profile }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const dependencies = await getProductionDashboardRouteDependencies();
    return createActiveRoleRouteHandler({ verifier: dependencies.verifier, profiles: dependencies.store })(request);
  } catch (error) {
    return serveHttp(request, async () => { throw error; });
  }
}
