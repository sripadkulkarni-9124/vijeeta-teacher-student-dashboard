import { AcceptInvitationRequestSchema, AcceptInvitationResponseSchema, type ClassroomMembership, type VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { ProfileRepository } from "../../../../server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, requireNoQuery, requireRole, serveHttp, type PrincipalVerifier } from "../../../../server/http";
import { productionInvitationReadDependencies } from "../../classes/route-support";

interface Dependencies {
  verifier: PrincipalVerifier;
  profiles: Pick<ProfileRepository, "getProfile">;
  invitations: { accept(principal: VerifiedPrincipal, token: string, context: { now: string; correlationId: string }): Promise<ClassroomMembership> };
  now?: () => string;
  createCorrelationId?: () => string;
}

export function createAcceptInvitationRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    await requireRole(principal, "student", dependencies.profiles);
    requireNoQuery(request);
    const input = await parseJsonBody(request, AcceptInvitationRequestSchema);
    const membership = await dependencies.invitations.accept(principal, input.token, { now: now(), correlationId });
    return jsonResponse(AcceptInvitationResponseSchema.parse({ membership }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request): Promise<Response> {
  try { return createAcceptInvitationRouteHandler(await productionInvitationReadDependencies())(request); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
