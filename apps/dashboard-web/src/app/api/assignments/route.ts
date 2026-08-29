import {
  ClassroomAssignmentResponseSchema,
  CreateDirectAssignmentRequestSchema,
} from "@vijeeta/api-contracts";

import type { AssignmentRepository } from "@/server/dashboard-store";
import { V3AdapterError, type V3ShareInput } from "@/server/v3-assignment-adapter";
import { HttpError, authenticateRequest, jsonResponse, parseIdempotencyKey, parseJsonBody, requireNoQuery, requireRole, serveHttp } from "@/server/http";
import { firebaseBearer, productionAssignmentDependencies, projectAssignment, type AssignmentRouteDependencies } from "./route-support";

interface Dependencies extends AssignmentRouteDependencies {
  assignments: AssignmentRepository;
  assignmentAdapter: { share(input: V3ShareInput, bearer: string): Promise<{ shareId: string; testId: string; runnerPath: string }> };
  now?: () => string;
}

/**
 * Creates a test addressed to students by email, with no classroom. It follows
 * the same prepare -> claim -> share -> complete sequence as a classroom
 * assignment, so a share that fails or times out lands in the same recoverable
 * states rather than a bespoke one.
 */
export function createDirectAssignmentRouteHandlers(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    POST: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authenticateRequest(request, dependencies.verifier);
      const profile = await requireRole(principal, "teacher", dependencies.profiles);
      if (profile.activeRole !== "teacher") throw new HttpError(403, "forbidden", "This action is not permitted");
      requireNoQuery(request);
      const input = await parseJsonBody(request, CreateDirectAssignmentRequestSchema);
      const prepared = await dependencies.assignments.prepareDirectAssignment(principal, {
        request: input, idempotencyKey: parseIdempotencyKey(request),
      }, { now: now(), correlationId });

      if (prepared.assignment.state !== "creating") {
        return jsonResponse(ClassroomAssignmentResponseSchema.parse({ assignment: projectAssignment(prepared.assignment) }), { correlationId });
      }
      const claimed = await dependencies.assignments.claimAssignmentShare(principal, prepared.assignment.id, { now: now(), correlationId });
      if (claimed.status === "already_claimed") {
        return jsonResponse(ClassroomAssignmentResponseSchema.parse({ assignment: projectAssignment(claimed.assignment) }), { correlationId });
      }

      let completion;
      try {
        const result = await dependencies.assignmentAdapter.share({
          jobId: prepared.assignment.jobId,
          recipientEmails: prepared.assignment.recipientSnapshot.map((recipient) => recipient.email),
          openAt: prepared.assignment.openAt,
          closeAt: prepared.assignment.closeAt,
          solutions: prepared.assignment.solutions,
        }, firebaseBearer(request));
        completion = { kind: "active" as const, ...result };
      } catch (error) {
        completion = error instanceof V3AdapterError && error.kind === "definite_rejection"
          ? { kind: "failed" as const, failureCode: safeFailureCode(error.code) }
          : { kind: "reconciliation_required" as const, reason: reconciliationReason(error) };
      }
      const assignment = await dependencies.assignments.completeAssignmentShare(
        principal, prepared.assignment.id, claimed.operationId, completion, { now: now(), correlationId },
      );
      return jsonResponse(ClassroomAssignmentResponseSchema.parse({ assignment: projectAssignment(assignment) }), { status: 201, correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

function safeFailureCode(code: string): string {
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : "v3_rejected";
}

function reconciliationReason(error: unknown): "timeout" | "disconnect" | "malformed_success" | "unknown" {
  if (!(error instanceof V3AdapterError)) return "unknown";
  if (error.code === "timeout") return "timeout";
  if (error.code === "disconnect") return "disconnect";
  if (["malformed_response", "wrong_content_type", "empty_response", "oversized_response"].includes(error.code)) return "malformed_success";
  return "unknown";
}

export async function POST(request: Request): Promise<Response> {
  try { return createDirectAssignmentRouteHandlers(await productionAssignmentDependencies()).POST(request); }
  catch (error) { return serveHttp(request, async () => { throw error; }); }
}
