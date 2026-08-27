import {
  DashboardProfileOnboardRequestSchema,
  DashboardProfileResponseSchema,
  type AdminBootstrapConfig,
} from "@vijeeta/api-contracts";

import { matchesAdminBootstrap } from "../../../server/admin-bootstrap";
import type { ProfileRepository } from "../../../server/dashboard-store";
import { getProductionDashboardRouteDependencies } from "../../../server/dashboard-runtime";
import {
  HttpError,
  authenticateRequest,
  jsonResponse,
  parseJsonBody,
  requireNoQuery,
  serveHttp,
  type PrincipalVerifier,
} from "../../../server/http";

interface ProfileRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: ProfileRepository;
  adminBootstrap: AdminBootstrapConfig;
  now?: () => string;
  createCorrelationId?: () => string;
}

export function createProfileRouteHandlers(dependencies: ProfileRouteDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      requireNoQuery(request);
      let profile = await dependencies.profiles.getProfile(principal.uid);
      if (matchesAdminBootstrap(principal, dependencies.adminBootstrap)) {
        profile = await dependencies.profiles.bootstrapAdmin(
          principal,
          dependencies.adminBootstrap,
          { now: now(), correlationId },
        );
      }
      if (profile === null) {
        throw new HttpError(404, "profile_not_found", "Profile onboarding is required");
      }
      const body = DashboardProfileResponseSchema.parse({ profile });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),

    POST: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      requireNoQuery(request);
      const input = await parseJsonBody(request, DashboardProfileOnboardRequestSchema);
      const profile = await dependencies.profiles.onboard(principal, input, {
        now: now(),
        correlationId,
      });
      const body = DashboardProfileResponseSchema.parse({ profile });
      return jsonResponse(body, { status: 201, correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await getProductionDashboardRouteDependencies();
    return createProfileRouteHandlers({
      verifier: dependencies.verifier,
      profiles: dependencies.store,
      adminBootstrap: dependencies.adminBootstrap,
    }).GET(request);
  } catch (error) {
    return serveHttp(request, async () => { throw error; });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const dependencies = await getProductionDashboardRouteDependencies();
    return createProfileRouteHandlers({
      verifier: dependencies.verifier,
      profiles: dependencies.store,
      adminBootstrap: dependencies.adminBootstrap,
    }).POST(request);
  } catch (error) {
    return serveHttp(request, async () => { throw error; });
  }
}
