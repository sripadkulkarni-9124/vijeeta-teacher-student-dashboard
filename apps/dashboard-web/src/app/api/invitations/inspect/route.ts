import { InspectInvitationRequestSchema, InspectInvitationResponseSchema, type InspectInvitationResponse, type VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../../server/dashboard-store";
import { HttpError, authenticateRequest, jsonResponse, parseJsonBody, requireNoQuery, serveHttp, type PrincipalVerifier } from "../../../../server/http";
import { productionInvitationReadDependencies } from "../../classes/route-support";

interface Dependencies {
  verifier: PrincipalVerifier;
  profiles: Pick<ProfileRepository, "getProfile">;
  invitations: { inspect(principal: VerifiedPrincipal, token: string): Promise<InspectInvitationResponse> };
  createCorrelationId?: () => string;
}

export function createInspectInvitationRouteHandler(dependencies: Dependencies) {
  return (request: Request) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    if (!principal.emailVerified || principal.email === null) throw new HttpError(403, "forbidden", "This action is not permitted");
    requireNoQuery(request);
    const input = await parseJsonBody(request, InspectInvitationRequestSchema);
    const inspected = await dependencies.invitations.inspect(principal, input.token);
    return jsonResponse(InspectInvitationResponseSchema.parse(inspected), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request): Promise<Response> {
  try { return createInspectInvitationRouteHandler(await productionInvitationReadDependencies())(request); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
