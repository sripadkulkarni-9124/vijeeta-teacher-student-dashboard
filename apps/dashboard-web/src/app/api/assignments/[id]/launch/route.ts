import { AssignmentLaunchResponseSchema } from "@vijeeta/api-contracts";

import type { AssignmentRepository } from "../../../../../server/dashboard-store";
import { HttpError, authenticateRequest, jsonResponse, parseRouteId, requireNoQuery, requireRole, serveHttp } from "../../../../../server/http";
import { productionAssignmentDependencies, type AssignmentRouteDependencies } from "../../route-support";

interface RouteContext { params: Promise<{ id: string }> }
interface Dependencies extends AssignmentRouteDependencies {
  assignments: AssignmentRepository;
  /** Origin of the approved test service the runner path belongs to. */
  runnerOrigin: string;
}

export function createAssignmentLaunchRouteHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return (request: Request, routeContext: RouteContext) => serveHttp(request, async ({ correlationId }) => {
    const principal = await authenticateRequest(request, dependencies.verifier);
    const profile = await requireRole(principal, "student", dependencies.profiles);
    if (profile.activeRole !== "student") throw new HttpError(403, "forbidden", "This action is not permitted");
    requireNoQuery(request);
    const assignmentId = parseRouteId((await routeContext.params).id);
    const assignment = await dependencies.assignments.getAssignmentForStudent(principal, assignmentId);
    if (assignment === null) throw new HttpError(404, "assignment_not_found", "Assignment was not found");
    const instant = Date.parse(now());
    if (assignment.state !== "active" || instant < Date.parse(assignment.openAt)
      || (assignment.closeAt !== null && instant >= Date.parse(assignment.closeAt))
      || !/^\/t\/[A-Za-z0-9_-]{16,256}$/.test(assignment.runnerPath)) {
      throw new HttpError(409, "assignment_unavailable", "Assignment launch is not available");
    }
    const runnerUrl = new URL(assignment.runnerPath, dependencies.runnerOrigin);
    if (runnerUrl.origin !== new URL(dependencies.runnerOrigin).origin) {
      throw new HttpError(409, "assignment_unavailable", "Assignment launch is not available");
    }
    return jsonResponse(AssignmentLaunchResponseSchema.parse({
      runnerPath: assignment.runnerPath,
      runnerUrl: runnerUrl.toString(),
    }), { correlationId });
  }, { createCorrelationId: dependencies.createCorrelationId });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { return createAssignmentLaunchRouteHandler(await productionAssignmentDependencies())(request, context); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
