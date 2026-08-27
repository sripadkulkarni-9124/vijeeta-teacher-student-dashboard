import { AssignmentInsightsResponseSchema, type V3IndividualTestInsight, type V3ShareResults } from "@vijeeta/api-contracts";

import type { AssignmentRepository } from "../../../../../server/dashboard-store";
import { HttpError, authenticateRequest, jsonResponse, parseRouteId, requireNoQuery, serveHttp } from "../../../../../server/http";
import { firebaseBearer, productionAssignmentDependencies, projectAggregate, projectPersonal, type AssignmentRouteDependencies } from "../../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Dependencies extends AssignmentRouteDependencies {
  assignments: AssignmentRepository;
  insights: {
    shareResults(shareId: string, bearer: string): Promise<V3ShareResults>;
    studentAnalysis(shareId: string, uid: string, bearer: string): Promise<V3IndividualTestInsight>;
    studentTestAnalysis(testId: string, uid: string, bearer: string): Promise<V3IndividualTestInsight>;
  };
}

export function createAssignmentInsightsRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    requireNoQuery(request);
    const profile = await dependencies.profiles.getProfile(principal.uid);
    if (profile === null || (profile.activeRole !== "teacher" && profile.activeRole !== "student")
      || profile.roles[profile.activeRole] !== "active") throw new HttpError(403, "forbidden", "This action is not permitted");
    const assignmentId = parseRouteId((await routeContext.params).id);
    const bearer = firebaseBearer(request);
    if (profile.activeRole === "teacher") {
      const assignment = await dependencies.assignments.getOwnedAssignment(principal, assignmentId);
      if (assignment === null) throw new HttpError(404, "assignment_not_found", "Assignment was not found");
      if (assignment.state !== "active") throw new HttpError(409, "assignment_unavailable", "Assignment insights are not available");
      const results = await dependencies.insights.shareResults(assignment.shareId, bearer);
      if (results.testId !== assignment.testId) throw new Error("V3 assignment result identity mismatch");
      return jsonResponse(AssignmentInsightsResponseSchema.parse({ freshness: now(), insights: { aggregate: projectAggregate(results) } }), { correlationId });
    }
    const assignment = await dependencies.assignments.getAssignmentForStudent(principal, assignmentId);
    if (assignment === null) throw new HttpError(404, "assignment_not_found", "Assignment was not found");
    if (assignment.state !== "active") throw new HttpError(409, "assignment_unavailable", "Assignment insights are not available");
    const insight = await dependencies.insights.studentTestAnalysis(assignment.testId, principal.uid, bearer);
    if (insight.testId !== assignment.testId || insight.uid !== principal.uid) throw new Error("V3 personal insight identity mismatch");
    return jsonResponse(AssignmentInsightsResponseSchema.parse({ freshness: now(), insights: { personal: projectPersonal(insight) } }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { return createAssignmentInsightsRouteHandler(await productionAssignmentDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
