import { AssignmentInsightsResponseSchema, type V3IndividualTestInsight } from "@vijeeta/api-contracts";

import type { AssignmentRepository } from "../../../../../../../server/dashboard-store";
import { HttpError, authenticateRequest, jsonResponse, parseRouteId, requireNoQuery, requireRole, serveHttp } from "../../../../../../../server/http";
import { firebaseBearer, productionAssignmentDependencies, projectIndividual, type AssignmentRouteDependencies } from "../../../../route-support";

interface RouteContext { params: Promise<{ id: string; uid: string }> }
interface Dependencies extends AssignmentRouteDependencies {
  assignments: AssignmentRepository;
  insights: { studentAnalysis(shareId: string, uid: string, bearer: string): Promise<V3IndividualTestInsight> };
}

export function createStudentAssignmentInsightRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    const profile = await requireRole(principal, "teacher", dependencies.profiles);
    if (profile.activeRole !== "teacher") throw new HttpError(403, "forbidden", "This action is not permitted");
    requireNoQuery(request);
    const params = await routeContext.params;
    const assignmentId = parseRouteId(params.id);
    const studentUid = parseRouteId(params.uid);
    const assignment = await dependencies.assignments.getOwnedAssignment(principal, assignmentId);
    if (assignment === null) throw new HttpError(404, "assignment_not_found", "Assignment was not found");
    if (assignment.state !== "active") throw new HttpError(409, "assignment_unavailable", "Assignment insights are not available");
    if (!assignment.recipientSnapshot.some((recipient) => recipient.uid === studentUid)) {
      throw new HttpError(403, "forbidden", "This action is not permitted");
    }
    const insight = await dependencies.insights.studentAnalysis(assignment.shareId, studentUid, firebaseBearer(request));
    if (insight.uid !== studentUid || insight.testId !== assignment.testId) throw new Error("V3 individual insight identity mismatch");
    return jsonResponse(AssignmentInsightsResponseSchema.parse({ freshness: now(), insights: { individual: projectIndividual(insight) } }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { return createStudentAssignmentInsightRouteHandler(await productionAssignmentDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
