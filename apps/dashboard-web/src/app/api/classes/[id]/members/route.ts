import { ClassroomInviteResponseSchema, ClassroomRosterResponseSchema, InviteClassroomMemberRequestSchema, type ClassroomInvite, type VerifiedPrincipal } from "@vijeeta/api-contracts";

import type { InvitationRepository, MutationContext } from "../../../../../server/dashboard-store";
import { authenticateRequest, jsonResponse, parseJsonBody, parseRouteId, requireNoQuery, requireRole, serveHttp } from "../../../../../server/http";
import { parseRosterPagination, productionClassroomDependencies, projectInvitation, type ClassroomRouteDependencies } from "../../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Coordinator { invite(principal: VerifiedPrincipal, classroomId: string, email: string, context: MutationContext): Promise<ClassroomInvite> }
interface Dependencies extends ClassroomRouteDependencies {
  invitations: InvitationRepository;
  coordinator: Coordinator;
  now?: () => string;
}

export function createClassroomMembersRouteHandlers(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    GET: (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      await requireRole(principal, "teacher", dependencies.profiles);
      const classroomId = parseRouteId((await routeContext.params).id);
      const roster = await dependencies.invitations.listRoster(principal, classroomId, parseRosterPagination(request));
      return jsonResponse(ClassroomRosterResponseSchema.parse(roster), { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
    POST: (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      await requireRole(principal, "teacher", dependencies.profiles);
      requireNoQuery(request);
      const classroomId = parseRouteId((await routeContext.params).id);
      const input = await parseJsonBody(request, InviteClassroomMemberRequestSchema);
      const invite = await dependencies.coordinator.invite(principal, classroomId, input.email, { now: now(), correlationId });
      return jsonResponse(ClassroomInviteResponseSchema.parse({ invite: projectInvitation(invite) }), { status: 201, correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const dependencies = await productionClassroomDependencies();
    return createClassroomMembersRouteHandlers({
      ...dependencies,
      coordinator: { invite: async () => { throw new Error("Production invitation delivery dependencies are not configured"); } },
    }).GET(request, context);
  } catch (error) { return serveHttp(request, async () => { throw error; }); }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const dependencies = await productionClassroomDependencies();
    return createClassroomMembersRouteHandlers({
      ...dependencies,
      coordinator: { invite: async () => { throw new Error("Production invitation delivery dependencies are not configured"); } },
    }).POST(request, context);
  } catch (error) { return serveHttp(request, async () => { throw error; }); }
}
