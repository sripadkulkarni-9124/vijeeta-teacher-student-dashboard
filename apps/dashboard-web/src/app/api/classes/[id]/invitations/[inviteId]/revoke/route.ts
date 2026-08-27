import { AdminReasonRequestSchema, ClassroomInviteResponseSchema } from "@vijeeta/api-contracts";

import type { InvitationRepository } from "@/server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, parseRouteId, requireNoQuery, requireRole, serveHttp } from "@/server/http";
import { productionClassroomDependencies, projectInvitation, type ClassroomRouteDependencies } from "../../../../route-support";

interface RouteContext { params: Promise<{ id: string; inviteId: string }> }
interface Dependencies extends ClassroomRouteDependencies { invitations: InvitationRepository; now?: () => string }

export function createTeacherRevokeInvitationRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    await requireRole(principal, "teacher", dependencies.profiles);
    requireNoQuery(request);
    const { id, inviteId } = await routeContext.params;
    const input = await parseJsonBody(request, AdminReasonRequestSchema);
    const invite = await dependencies.invitations.revokeInvitation(principal, parseRouteId(id), parseRouteId(inviteId), { now: now(), correlationId, reason: input.reason });
    return jsonResponse(ClassroomInviteResponseSchema.parse({ invite: projectInvitation(invite) }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try { return createTeacherRevokeInvitationRouteHandler(await productionClassroomDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
