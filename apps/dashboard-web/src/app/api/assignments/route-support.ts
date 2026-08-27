import {
  AssignmentAggregateInsightSchema,
  AssignmentIndividualInsightSchema,
  AssignmentPersonalInsightSchema,
  type V3IndividualTestInsight,
  type V3ShareResults,
} from "@vijeeta/api-contracts";

import type { AssignmentRepository, ProfileRepository } from "../../../server/dashboard-store";
import { getProductionDashboardRouteDependencies } from "../../../server/dashboard-runtime";
import type { PrincipalVerifier } from "../../../server/http";
import { loadRuntimeConfig } from "../../../server/runtime-config";
import { V3AssignmentAdapter } from "../../../server/v3-assignment-adapter";
import { V3InsightAdapter } from "../../../server/v3-insight-adapter";

export interface AssignmentRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: Pick<ProfileRepository, "getProfile">;
  assignments: AssignmentRepository;
  now?: () => string;
  createCorrelationId?: () => string;
}

export function firebaseBearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(authorization)) {
    throw new Error("Verified Firebase bearer is unavailable");
  }
  return authorization.slice("Bearer ".length);
}

export function projectAggregate(results: V3ShareResults) {
  return AssignmentAggregateInsightSchema.parse({
    attempted: results.funnel.attempted,
    pending: results.funnel.pending,
    averageScore: results.averageScore ?? 0,
  });
}

export function projectIndividual(insight: V3IndividualTestInsight) {
  return AssignmentIndividualInsightSchema.parse({
    uid: insight.uid,
    displayName: insight.title ?? insight.uid,
    score: insight.score,
    status: insight.available && insight.score !== null ? "attempted" : "pending",
  });
}

export function projectPersonal(insight: V3IndividualTestInsight) {
  const current = insight.score ?? 0;
  return AssignmentPersonalInsightSchema.parse({
    attempted: insight.available && insight.score !== null ? 1 : 0,
    averageScore: current,
    score: current,
    latestScore: insight.score,
  });
}

export async function productionAssignmentDependencies() {
  const runtime = await getProductionDashboardRouteDependencies();
  const config = loadRuntimeConfig();
  const options = { baseUrl: config.baseUrl, timeoutMs: config.timeoutMs, fetchImpl: globalThis.fetch.bind(globalThis) };
  return {
    verifier: runtime.verifier,
    profiles: runtime.store,
    assignments: runtime.store,
    assignmentAdapter: new V3AssignmentAdapter(options),
    insights: new V3InsightAdapter(options),
  };
}
