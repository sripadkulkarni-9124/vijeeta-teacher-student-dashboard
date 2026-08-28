"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AssignmentInsightsResponse,
  Classroom,
  ClassroomAssignmentProjection,
} from "@vijeeta/api-contracts";

import { createConnectedApi, type ConnectedApi } from "@/client/connected-api";
import { createFirebaseAuth } from "@/client/firebase-auth";

export const STUDENT_CLIENT_METHODS = [
  "listClasses",
  "listAssignments",
  "launchAssignment",
  "getAssignmentInsights",
] as const;

export type StudentDashboardApi = Pick<ConnectedApi, (typeof STUDENT_CLIENT_METHODS)[number]>;

export const STUDENT_SECTION_HASHES = ["#student-tests", "#student-results"] as const;

type SectionHash = (typeof STUDENT_SECTION_HASHES)[number];
type Feedback = { tone: "success" | "error"; message: string };

const PAGE_SIZE = 50;

function defaultApi(): StudentDashboardApi {
  const auth = createFirebaseAuth();
  return createConnectedApi({ getIdToken: (forceRefresh) => auth.getIdToken(forceRefresh) });
}

function currentSection(): SectionHash {
  if (typeof window === "undefined") return "#student-tests";
  const hash = window.location.hash as SectionHash;
  return STUDENT_SECTION_HASHES.includes(hash) ? hash : "#student-tests";
}

export function studentFailureCopy(error: unknown): { denied: boolean; message: string } {
  const candidate = error && typeof error === "object" ? error as { status?: number; correlationId?: string } : {};
  const safeCorrelationId = typeof candidate.correlationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate.correlationId)
    ? candidate.correlationId
    : null;
  if (candidate.status === 401 || candidate.status === 403) {
    return { denied: true, message: "Student access could not be verified. Sign in again or contact your teacher." };
  }
  return {
    denied: false,
    message: `The action could not be completed.${safeCorrelationId ? ` Reference: ${safeCorrelationId}.` : " Try again."}`,
  };
}

function statusIcon(state: string): string {
  if (state === "active") return "✓";
  if (state === "creating") return "◷";
  return "!";
}

function Status({ value }: { value: string }) {
  const words = value.replaceAll("_", " ");
  const label = `${words[0]!.toUpperCase()}${words.slice(1)}`;
  return <span className={`academic-status academic-status--${value}`}><span aria-hidden="true">{statusIcon(value)}</span>{label}</span>;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 10) / 10}`;
}

/**
 * The launch handoff is server-validated. The browser only follows the returned
 * relative runner path; it never composes a V3 origin of its own.
 */
export function isSafeRunnerPath(runnerPath: string): boolean {
  return runnerPath.startsWith("/") && !runnerPath.startsWith("//") && runnerPath.length <= 512;
}

export function ConnectedStudentDashboard({ api = defaultApi(), onAuthorizationLost, onLaunch }: {
  api?: StudentDashboardApi;
  onAuthorizationLost?: () => void;
  onLaunch?: (runnerPath: string) => void;
}) {
  const [section, setSection] = useState<SectionHash>(currentSection);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<ClassroomAssignmentProjection[]>([]);
  const [insights, setInsights] = useState<Record<string, AssignmentInsightsResponse>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [denied, setDenied] = useState(false);

  // Held in a ref so `report` keeps a stable identity. Callers pass this as an
  // inline arrow, and a changing identity would cascade through the loaders
  // into the effects below, re-running them on every render.
  const authorizationLost = useRef(onAuthorizationLost);
  useEffect(() => { authorizationLost.current = onAuthorizationLost; }, [onAuthorizationLost]);

  const report = useCallback((error: unknown) => {
    const copy = studentFailureCopy(error);
    setFeedback({ tone: "error", message: copy.message });
    if (copy.denied) {
      setDenied(true);
      authorizationLost.current?.();
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.listClasses({ limit: PAGE_SIZE });
      setClasses(page.classrooms);
      const pages = await Promise.all(
        page.classrooms.map((classroom) => api.listAssignments(classroom.id, { limit: PAGE_SIZE })),
      );
      setAssignments(pages.flatMap((entry) => entry.assignments));
      setDenied(false);
    } catch (error) {
      report(error);
    } finally {
      setLoading(false);
    }
  }, [api, report]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const sync = () => setSection(currentSection());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const classNames = useMemo(
    () => new Map(classes.map((classroom) => [classroom.id, classroom.name])),
    [classes],
  );

  const available = assignments.filter((assignment) => assignment.state === "active");

  const launch = (assignmentId: string) => {
    setBusy(`launch-${assignmentId}`);
    setFeedback(null);
    void (async () => {
      try {
        const { runnerPath } = await api.launchAssignment(assignmentId);
        if (!isSafeRunnerPath(runnerPath)) {
          setFeedback({ tone: "error", message: "The test could not be opened because the launch target was rejected." });
          return;
        }
        setFeedback({ tone: "success", message: "Test ready. Opening the secure runner." });
        onLaunch?.(runnerPath);
      } catch (error) {
        report(error);
      } finally {
        setBusy(null);
      }
    })();
  };

  const loadInsights = (assignmentId: string) => {
    setBusy(`insights-${assignmentId}`);
    setFeedback(null);
    void (async () => {
      try {
        const response = await api.getAssignmentInsights(assignmentId);
        setInsights((current) => ({ ...current, [assignmentId]: response }));
        setFeedback({ tone: "success", message: "Your results are up to date." });
      } catch (error) {
        report(error);
      } finally {
        setBusy(null);
      }
    })();
  };

  if (denied) {
    return (
      <section className="academic-feedback academic-feedback--error" role="alert">
        <h2>Student workspace unavailable</h2>
        <p>Student access could not be verified. Sign in again or contact your teacher.</p>
      </section>
    );
  }

  const released = Object.keys(insights).length;

  return (
    <div className="student-connected">
      <header className="academic-card__header">
        <div><p className="academic-overline">Your learning</p><h1>Student workspace</h1><p>See the classes you joined, start the tests assigned to you, and review your own results.</p></div>
      </header>
      {feedback ? (
        <p className={`academic-feedback academic-feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </p>
      ) : null}

      <section className="academic-metric-row" aria-label="Student overview">
        <article className="academic-metric"><p className="academic-metric__label">Classes</p><p className="academic-metric__value">{classes.length}</p></article>
        <article className="academic-metric"><p className="academic-metric__label">Tests to take</p><p className="academic-metric__value">{available.length}</p></article>
        <article className="academic-metric"><p className="academic-metric__label">Results released</p><p className="academic-metric__value">{released}</p></article>
      </section>

      <section aria-labelledby="student-tests-title" className="academic-card" hidden={section !== "#student-tests"} id="student-tests">
        <header className="academic-card__header">
          <h2 id="student-tests-title">Assigned tests</h2>
        </header>
        {loading ? <p role="status">Loading your classes…</p> : null}
        {!loading && classes.length === 0 ? <p>You are not in a class yet. Accept an invitation from your teacher to join one.</p> : null}
        {!loading && classes.length > 0 && assignments.length === 0 ? <p>No tests have been assigned to your classes yet.</p> : null}
        {assignments.length > 0 ? (
          <div className="academic-table-wrap"><table>
            <caption>Tests assigned to your classes</caption>
            <thead><tr><th scope="col">Test</th><th scope="col">Class</th><th scope="col">State</th><th scope="col">Opens</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <th scope="row">{assignment.jobId}</th>
                  <td>{classNames.get(assignment.classroomId) ?? "Class"}</td>
                  <td><Status value={assignment.state} /></td>
                  <td>{assignment.openAt.slice(0, 10)}</td>
                  <td>
                    <button
                      className="academic-button academic-button--primary"
                      disabled={busy !== null || assignment.state !== "active"}
                      onClick={() => launch(assignment.id)}
                      type="button"
                    >
                      {busy === `launch-${assignment.id}` ? "Opening…" : "Start test"}
                    </button>
                    <button
                      className="academic-button academic-button--quiet"
                      disabled={busy !== null}
                      onClick={() => loadInsights(assignment.id)}
                      type="button"
                    >
                      {busy === `insights-${assignment.id}` ? "Loading…" : "View result"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
      </section>

      <section aria-labelledby="student-results-title" className="academic-card" hidden={section !== "#student-results"} id="student-results">
        <header className="academic-card__header">
          <h2 id="student-results-title">Your results</h2>
        </header>
        {released === 0 ? <p>No results yet. Open a test result from your assigned tests to see it here.</p> : null}
        {Object.entries(insights).map(([assignmentId, response]) => {
          const personal = response.insights.personal;
          return (
            <article className="academic-card" key={assignmentId}>
              <h3>{assignments.find((assignment) => assignment.id === assignmentId)?.jobId ?? assignmentId}</h3>
              <p className="academic-subtitle">Refreshed {response.freshness.slice(0, 16).replace("T", " ")}</p>
              {personal ? (
                <section className="academic-metric-row" aria-label="Your performance">
                  <article className="academic-metric"><p className="academic-metric__label">Score</p><p className="academic-metric__value">{formatScore(personal.score)}</p></article>
                  <article className="academic-metric"><p className="academic-metric__label">Attempted</p><p className="academic-metric__value">{personal.attempted}</p></article>
                  <article className="academic-metric"><p className="academic-metric__label">Average</p><p className="academic-metric__value">{formatScore(personal.averageScore)}</p></article>
                  <article className="academic-metric"><p className="academic-metric__label">Latest</p><p className="academic-metric__value">{formatScore(personal.latestScore)}</p></article>
                </section>
              ) : <p>This result is not available to you yet.</p>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
