import { AdminReasonRequestSchema, ClassroomInviteResponseSchema, type ClassroomInvite, type VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { MutationContext } from "@/server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, parseRouteId, requireNoQuery, requireRole, serveHttp } from "@/server/http";
import { productionClassroomDependencies, projectInvitation, type ClassroomRouteDependencies } from "../../../../route-support";

interface RouteContext { params: Promise<{ id: string; inviteId: string }> }
interface Coordinator { redeliver(principal: VerifiedPrincipal, classroomId: string, invitationId: string, context: MutationContext): Promise<ClassroomInvite> }
interface Dependencies extends ClassroomRouteDependencies { coordinator: Coordinator; now?: () => string }

export function createTeacherRedeliverInvitationRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    await requireRole(principal, "teacher", dependencies.profiles);
    requireNoQuery(request);
    const { id, inviteId } = await routeContext.params;
    const input = await parseJsonBody(request, AdminReasonRequestSchema);
    const invite = await dependencies.coordinator.redeliver(principal, parseRouteId(id), parseRouteId(inviteId), { now: now(), correlationId, reason: input.reason });
    return jsonResponse(ClassroomInviteResponseSchema.parse({ invite: projectInvitation(invite) }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const dependencies = await productionClassroomDependencies();
    return createTeacherRedeliverInvitationRouteHandler({ ...dependencies, coordinator: { redeliver: async () => { throw new Error("Production invitation delivery dependencies are not configured"); } } })(request, context);
  } catch (error) { return serveHttp(request, async () => { throw error; }); }
}
