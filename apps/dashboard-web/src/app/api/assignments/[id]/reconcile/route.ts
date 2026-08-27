import { ReconcileAssignmentRequestSchema, type V3ShareResults } from "@vijeeta/api-contracts";

import type { AssignmentRepository } from "../../../../../server/dashboard-store";
import { HttpError, authenticateRequest, parseJsonBody, parseRouteId, requireNoQuery, requireRole, serveHttp } from "../../../../../server/http";
import { firebaseBearer, productionAssignmentDependencies, type AssignmentRouteDependencies } from "../../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Dependencies extends AssignmentRouteDependencies {
  assignments: AssignmentRepository;
  insights: { shareResults(shareId: string, bearer: string): Promise<V3ShareResults> };
}

export function createReconcileAssignmentRouteHandler(dependencies: Dependencies) {
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async () => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    const profile = await requireRole(principal, "teacher", dependencies.profiles);
    if (profile.activeRole !== "teacher") throw new HttpError(403, "forbidden", "This action is not permitted");
    requireNoQuery(request);
    const assignmentId = parseRouteId((await routeContext.params).id);
    const input = await parseJsonBody(request, ReconcileAssignmentRequestSchema);
    const assignment = await dependencies.assignments.getOwnedAssignment(principal, assignmentId);
    if (assignment === null) throw new HttpError(404, "assignment_not_found", "Assignment was not found");
    if (assignment.state !== "reconciliation_required") throw new HttpError(409, "conflict", "The requested state transition is not available");
    if (input.resolution === "retry_confirmed_absent") {
      throw new HttpError(409, "reconciliation_retry_unsupported", "Safe automatic retry is not supported");
    }
    const results = await dependencies.insights.shareResults(input.shareId!, firebaseBearer(request));
    if (results.shareId !== input.shareId) throw new HttpError(409, "reconciliation_mismatch", "The supplied V3 share could not be verified");
    // The exact owner-results API proves ownership but does not return a runner path.
    // Keep the assignment non-launchable rather than deriving or exposing a capability token.
    throw new HttpError(409, "reconciliation_link_incomplete", "The verified V3 share cannot be safely linked for launch");
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try { return createReconcileAssignmentRouteHandler(await productionAssignmentDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
