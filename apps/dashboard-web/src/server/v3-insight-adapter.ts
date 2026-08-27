import {
  V3IndividualTestInsightSchema,
  V3ShareResultsSchema,
  V3StudentAttemptsSchema,
  V3StudentOverallInsightSchema,
  V3StudentTestListSchema,
  V3StudentTestReadSchema,
  V3StudentTestReviewSchema,
  type V3IndividualTestInsight,
  type V3ShareResults,
  type V3StudentAttempts,
  type V3StudentOverallInsight,
  type V3StudentTestList,
  type V3StudentTestRead,
  type V3StudentTestReview,
} from "@vijeeta/api-contracts";

import {
  V3AdapterError,
  V3Transport,
  validateRunnerPath,
  validateV3Id,
  type V3AdapterOptions,
} from "./v3-assignment-adapter";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V3AdapterError("unavailable", "malformed_response", false);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function safeUid(uid: string): string { return validateV3Id(uid, "user_id"); }

export class V3InsightAdapter {
  private readonly transport: V3Transport;

  constructor(options: V3AdapterOptions) { this.transport = new V3Transport(options); }

  async shareResults(shareIdInput: string, bearer: string): Promise<V3ShareResults> {
    const shareId = validateV3Id(shareIdInput, "share_id");
    const payload = record(await this.transport.json(`/v3/paperdesk/shares/${shareId}/results`, "GET", bearer, undefined, "read"));
    try {
      const share = record(payload.share);
      const funnel = record(payload.funnel);
      const batch = optionalRecord(payload.batch);
      const students = Array.isArray(payload.students) ? payload.students.map((raw) => {
        const student = record(raw);
        return {
          uid: typeof student.uid === "string" ? validateV3Id(student.uid, "user_id") : null,
          attempted: student.attempted === true,
          score: score(student.score),
          maxScore: score(student.max),
          accuracy: score(student.accuracy),
          timeMs: integer(student.time_ms),
        };
      }) : payload.students;
      return V3ShareResultsSchema.parse({
        shareId: share.id,
        testId: share.test_id,
        funnel: { shared: funnel.shared, attempted: funnel.attempted, pending: funnel.pending },
        averageScore: score(batch?.mean),
        students,
      });
    } catch (error) {
      if (error instanceof V3AdapterError && error.kind !== "invalid_input") throw error;
      throw new V3AdapterError("unavailable", "malformed_response", false);
    }
  }

  async studentAnalysis(shareIdInput: string, studentUidInput: string, bearer: string): Promise<V3IndividualTestInsight> {
    const shareId = validateV3Id(shareIdInput, "share_id");
    const uid = safeUid(studentUidInput);
    const payload = await this.transport.json(`/v3/paperdesk/shares/${shareId}/student/${uid}/analysis`, "GET", bearer, undefined, "read");
    return this.projectTestInsight(payload, uid);
  }

  async studentTests(studentUid: string, bearer: string): Promise<V3StudentTestList> {
    safeUid(studentUid);
    const payload = record(await this.transport.json("/v3/shared/tests", "GET", bearer, undefined, "read"));
    try {
      const tests = Array.isArray(payload.tests) ? payload.tests.map((raw) => {
        const test = record(raw);
        const teacher = typeof test.teacher === "string" ? test.teacher.split("@", 1)[0]?.trim() : null;
        return {
          testId: test.test_id,
          title: test.title,
          teacherLabel: teacher,
          kind: test.kind,
          sharedAtEpochSeconds: test.shared,
          state: test.state,
          score: score(test.score),
          maxScore: score(test.max),
          runnerPath: test.web_path === undefined ? null : validateRunnerPath(test.web_path, this.transport.origin),
        };
      }) : payload.tests;
      return V3StudentTestListSchema.parse({ tests });
    } catch (error) {
      if (error instanceof V3AdapterError && error.kind !== "invalid_input") throw error;
      throw new V3AdapterError("unavailable", "malformed_response", false);
    }
  }

  async studentLaunch(testIdInput: string, studentUid: string, bearer: string): Promise<{ testId: string; runnerPath: string }> {
    const testId = validateV3Id(testIdInput, "test_id");
    const tests = await this.studentTests(studentUid, bearer);
    const card = tests.tests.find((candidate) => candidate.testId === testId);
    if (!card?.runnerPath) throw new V3AdapterError("unavailable", "runner_unavailable", false);
    return { testId, runnerPath: card.runnerPath };
  }

  async studentTest(testIdInput: string, studentUid: string, bearer: string): Promise<V3StudentTestRead> {
    const testId = validateV3Id(testIdInput, "test_id");
    safeUid(studentUid);
    const payload = record(await this.transport.json(`/v3/test/${testId}`, "GET", bearer, undefined, "read"));
    try {
      const window = payload.window === undefined ? null : record(payload.window);
      return V3StudentTestReadSchema.parse({
        testId: payload.test_id,
        title: payload.title,
        kind: payload.kind,
        durationMinutes: payload.duration_min,
        sectionCount: Array.isArray(payload.sections) ? payload.sections.length : null,
        window: window ? { open: score(window.open), close: score(window.close) } : null,
      });
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }

  async studentAttempts(studentUidInput: string, bearer: string): Promise<V3StudentAttempts> {
    const uid = safeUid(studentUidInput);
    const payload = record(await this.transport.json(`/v3/test/attempts?user_id=${encodeURIComponent(uid)}`, "GET", bearer, undefined, "read"));
    try {
      const attempts = Array.isArray(payload.attempts) ? payload.attempts.slice(0, 500).map((raw) => {
        const attempt = record(raw);
        let attemptedAt: string | null = null;
        if (typeof attempt.ts === "string") attemptedAt = attempt.ts;
        else if (typeof attempt.ts === "number" && Number.isFinite(attempt.ts)) attemptedAt = new Date(attempt.ts * 1000).toISOString();
        return { testId: attempt.test_id, title: typeof attempt.title === "string" ? attempt.title : null, score: score(attempt.score), maxScore: score(attempt.max), attemptedAt };
      }) : payload.attempts;
      return V3StudentAttemptsSchema.parse({ attempts });
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }

  async studentReview(testIdInput: string, studentUidInput: string, bearer: string): Promise<V3StudentTestReview> {
    const testId = validateV3Id(testIdInput, "test_id");
    const uid = safeUid(studentUidInput);
    const payload = record(await this.transport.json(`/v3/test/${testId}/review?user_id=${encodeURIComponent(uid)}`, "GET", bearer, undefined, "read"));
    try {
      return V3StudentTestReviewSchema.parse({
        testId: payload.test_id,
        available: payload.locked !== true,
        locked: payload.locked === true,
        score: score(payload.score),
        maxScore: score(payload.max),
        solutionsHidden: typeof payload.solutions_hidden === "string" ? payload.solutions_hidden : null,
      });
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }

  async studentTestAnalysis(testIdInput: string, studentUidInput: string, bearer: string): Promise<V3IndividualTestInsight> {
    const testId = validateV3Id(testIdInput, "test_id");
    const uid = safeUid(studentUidInput);
    const payload = await this.transport.json(`/v3/test/${testId}/analysis?user_id=${encodeURIComponent(uid)}`, "GET", bearer, undefined, "read");
    return this.projectTestInsight(payload, uid);
  }

  async studentOverall(studentUidInput: string, bearer: string): Promise<V3StudentOverallInsight> {
    const uid = safeUid(studentUidInput);
    const payload = record(await this.transport.json(`/v3/analysis/overall?user_id=${encodeURIComponent(uid)}`, "GET", bearer, undefined, "read"));
    try {
      const readiness = optionalRecord(payload.readiness);
      const growth = optionalRecord(payload.growth);
      return V3StudentOverallInsightSchema.parse({
        available: payload.available,
        message: typeof payload.message === "string" ? payload.message : null,
        testCount: typeof payload.n === "number" ? payload.n : 0,
        readinessMarks: score(readiness?.marks),
        readinessOf: score(readiness?.of),
        readinessPercentile: score(readiness?.percentile),
        growthVerdict: typeof growth?.verdict === "string" ? growth.verdict : null,
        growthPerTest: score(growth?.slope_pct_per_test),
      });
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }

  private projectTestInsight(value: unknown, uid: string): V3IndividualTestInsight {
    const payload = record(value);
    try {
      const percentile = optionalRecord(payload.percentile);
      return V3IndividualTestInsightSchema.parse({
        uid,
        testId: payload.test_id,
        available: payload.available !== false,
        title: typeof payload.title === "string" ? payload.title : null,
        score: score(payload.score),
        maxScore: score(payload.max),
        percentile: score(percentile?.percentile),
        deltaFromPrevious: score(payload.delta_last),
      });
    } catch { throw new V3AdapterError("unavailable", "malformed_response", false); }
  }
}
