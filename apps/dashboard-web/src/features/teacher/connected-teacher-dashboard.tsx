"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type {
  AssignmentInsightsResponse,
  Classroom,
  ClassroomAssignmentProjection,
  ClassroomRosterInvitation,
  ClassroomRosterMember,
} from "@vijeeta/api-contracts";

import { createConnectedApi, type ConnectedApi } from "@/client/connected-api";
import { createFirebaseAuth } from "@/client/firebase-auth";

export const TEACHER_CLIENT_METHODS = [
  "listClasses",
  "createClassroom",
  "archiveClassroom",
  "getClassroomRoster",
  "inviteClassroomMember",
  "revokeClassroomInvitation",
  "redeliverClassroomInvitation",
  "listAssignments",
  "createAssignment",
  "createDirectAssignment",
  "listTestJobs",
  "getAssignmentInsights",
  "getStudentAssignmentInsights",
] as const;

export type TeacherDashboardApi = Pick<ConnectedApi, (typeof TEACHER_CLIENT_METHODS)[number]>;

export const TEACHER_SECTION_HASHES = ["#teacher-classes", "#teacher-roster", "#teacher-assignments", "#teacher-insights"] as const;

type SectionHash = (typeof TEACHER_SECTION_HASHES)[number];

type RosterState = {
  members: ClassroomRosterMember[];
  invitations: ClassroomRosterInvitation[];
};

type InsightState = {
  assignmentId: string;
  response: AssignmentInsightsResponse;
};

type Feedback = { tone: "success" | "error"; message: string };

const EMPTY_ROSTER: RosterState = { members: [], invitations: [] };
const PAGE_SIZE = 50;

function defaultApi(): TeacherDashboardApi {
  const auth = createFirebaseAuth();
  return createConnectedApi({ getIdToken: (forceRefresh) => auth.getIdToken(forceRefresh) });
}

function currentSection(): SectionHash {
  if (typeof window === "undefined") return "#teacher-classes";
  const hash = window.location.hash as SectionHash;
  return TEACHER_SECTION_HASHES.includes(hash) ? hash : "#teacher-classes";
}

function statusIcon(status: string): string {
  if (["active", "accepted", "sent"].includes(status)) return "✓";
  if (["pending", "redelivery_requested", "creating", "unknown"].includes(status)) return "◷";
  return "!";
}

function Status({ value }: { value: string }) {
  const words = value.replaceAll("_", " ");
  const label = `${words[0]!.toUpperCase()}${words.slice(1)}`;
  return <span className={`academic-status academic-status--${value}`}><span aria-hidden="true">{statusIcon(value)}</span>{label}</span>;
}

/**
 * Server problems are surfaced without echoing server text. Authorization loss is
 * reported as a distinct denial so the caller can re-authenticate rather than retry.
 */
export function teacherFailureCopy(error: unknown): { denied: boolean; message: string } {
  const candidate = error && typeof error === "object" ? error as { status?: number; correlationId?: string } : {};
  const safeCorrelationId = typeof candidate.correlationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate.correlationId)
    ? candidate.correlationId
    : null;
  if (candidate.status === 401 || candidate.status === 403) {
    return { denied: true, message: "Teacher access could not be verified. Sign in again or contact an administrator." };
  }
  return {
    denied: false,
    message: `The action could not be completed.${safeCorrelationId ? ` Reference: ${safeCorrelationId}.` : " Try again."}`,
  };
}

function formatScore(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 10) / 10}`;
}

function InviteDialog({ classroomName, busy, onCancel, onConfirm }: {
  classroomName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="academic-dialog-backdrop">
      <section
        aria-labelledby="teacher-invite-title"
        aria-modal="true"
        className="academic-dialog"
        onKeyDown={handleKeyDown}
        ref={dialog}
        role="dialog"
      >
        <h2 id="teacher-invite-title">Invite student</h2>
        <p>An invitation is sent to this address for {classroomName}. Delivery is recorded as an intent and is not a confirmation that the message arrived.</p>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!busy) onConfirm(email);
          }}
        >
          <label htmlFor="teacher-invite-email">Student email</label>
          <input
            autoComplete="off"
            id="teacher-invite-email"
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
            ref={input}
            required
            type="email"
            value={email}
          />
          <div className="academic-dialog__actions">
            <button className="academic-button academic-button--quiet" disabled={busy} onClick={onCancel} type="button">Cancel</button>
            <button className="academic-button academic-button--primary" disabled={busy || email.trim() === ""} type="submit">
              {busy ? "Inviting…" : "Send invitation"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ConnectedTeacherDashboard({ api: suppliedApi, onAuthorizationLost }: {
  api?: TeacherDashboardApi;
  onAuthorizationLost?: () => void;
}) {
  // A default parameter is evaluated on every render, so an unsupplied api was
  // a new object each time. That changed the loaders' identity, re-fired their
  // effects, and left the view loading forever.
  const api = useMemo(() => suppliedApi ?? defaultApi(), [suppliedApi]);
  const [section, setSection] = useState<SectionHash>(currentSection);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
  const [assignments, setAssignments] = useState<ClassroomAssignmentProjection[]>([]);
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [jobId, setJobId] = useState("");
  const [directJobId, setDirectJobId] = useState("");
  const [directEmails, setDirectEmails] = useState("");
  const [testJobs, setTestJobs] = useState<{ id: string; title: string }[] | null>(null);

  const selectedClass = useMemo(
    () => classes.find((classroom) => classroom.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  // Held in a ref so `report` keeps a stable identity. Callers pass this as an
  // inline arrow, and a changing identity would cascade through the loaders
  // into the effects below, re-running them on every render.
  const authorizationLost = useRef(onAuthorizationLost);
  useEffect(() => { authorizationLost.current = onAuthorizationLost; }, [onAuthorizationLost]);

  /**
   * A failed background refresh is reported quietly next to the data it belongs
   * to. The banner is for actions the viewer took, so a transient read does not
   * fill the page with an alarming message the viewer cannot act on.
   */
  const report = useCallback((error: unknown, background = false) => {
    const copy = teacherFailureCopy(error);
    if (background) setLoadError(copy.message);
    else setFeedback({ tone: "error", message: copy.message });
    if (copy.denied) {
      setDenied(true);
      authorizationLost.current?.();
    }
  }, []);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.listClasses({ limit: PAGE_SIZE });
      setClasses(page.classrooms);
      setSelectedClassId((current) => current ?? page.classrooms[0]?.id ?? null);
      setDenied(false);
      setLoadError(null);
    } catch (error) {
      report(error, true);
    } finally {
      setLoading(false);
    }
  }, [api, report]);

  const loadClassDetail = useCallback(async (classroomId: string) => {
    try {
      const [rosterPage, assignmentPage] = await Promise.all([
        api.getClassroomRoster(classroomId, { limit: PAGE_SIZE }),
        api.listAssignments(classroomId, { limit: PAGE_SIZE }),
      ]);
      setRoster({ members: rosterPage.members, invitations: rosterPage.invitations });
      setAssignments(assignmentPage.assignments);
      setLoadError(null);
    } catch (error) {
      report(error, true);
    }
  }, [api, report]);

  useEffect(() => { void loadClasses(); }, [loadClasses]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const page = await api.listTestJobs();
        if (active) setTestJobs(page.jobs.map((job) => ({ id: job.id, title: job.title })));
      } catch {
        // The picker is a convenience. If the test service cannot be reached the
        // teacher can still type an id, so this failure is not surfaced.
        if (active) setTestJobs([]);
      }
    })();
    return () => { active = false; };
  }, [api]);

  const testPicker = (id: string, label: string, value: string, onChange: (next: string) => void) => (
    <div className="academic-field">
      <label htmlFor={id}>{label}</label>
      {testJobs !== null && testJobs.length > 0 ? (
        <select id={id} onChange={(event) => onChange(event.target.value)} required value={value}>
          <option value="">Choose a test…</option>
          {testJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
        </select>
      ) : (
        <input id={id} maxLength={128} onChange={(event) => onChange(event.target.value)} placeholder="JOB-1024" required value={value} />
      )}
    </div>
  );

  useEffect(() => {
    if (selectedClassId === null) return;
    setRoster(EMPTY_ROSTER);
    setAssignments([]);
    setInsight(null);
    void loadClassDetail(selectedClassId);
  }, [loadClassDetail, selectedClassId]);

  useEffect(() => {
    const sync = () => setSection(currentSection());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const run = useCallback(async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setFeedback(null);
    try {
      setFeedback({ tone: "success", message: await action() });
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  }, [report]);

  const createClass = () => run("create-class", async () => {
    const created = await api.createClassroom({ name: newClassName.trim() });
    setClasses((current) => [created.classroom, ...current]);
    setSelectedClassId(created.classroom.id);
    setNewClassName("");
    return "Class created";
  });

  const invite = (email: string) => run("invite", async () => {
    if (selectedClassId === null) throw new Error("no class selected");
    await api.inviteClassroomMember(selectedClassId, { email: email.trim().toLowerCase() });
    setInviteOpen(false);
    await loadClassDetail(selectedClassId);
    return "Invitation recorded";
  });

  const revoke = (inviteId: string) => run(`revoke-${inviteId}`, async () => {
    if (selectedClassId === null) throw new Error("no class selected");
    await api.revokeClassroomInvitation(selectedClassId, inviteId, { reason: "Revoked by the class teacher" });
    await loadClassDetail(selectedClassId);
    return "Invitation revoked";
  });

  const redeliver = (inviteId: string) => run(`redeliver-${inviteId}`, async () => {
    if (selectedClassId === null) throw new Error("no class selected");
    await api.redeliverClassroomInvitation(selectedClassId, inviteId, { reason: "Redelivery requested by the class teacher" });
    await loadClassDetail(selectedClassId);
    return "Invitation redelivery requested";
  });

  const assign = () => run("assign", async () => {
    if (selectedClassId === null) throw new Error("no class selected");
    const openAt = new Date().toISOString();
    const created = await api.createAssignment(selectedClassId, {
      jobId: jobId.trim(),
      openAt,
      closeAt: null,
      solutions: "on_submit",
    }, crypto.randomUUID());
    setAssignments((current) => [created.assignment, ...current]);
    setJobId("");
    return "Assignment scheduled";
  });

  /** A test addressed straight to students, with no class involved. */
  const assignDirect = () => run("assign-direct", async () => {
    const recipientEmails = directEmails
      .split(/[\n,;]/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== "");
    if (recipientEmails.length === 0) throw new Error("no recipients");
    const created = await api.createDirectAssignment({
      jobId: directJobId.trim(),
      recipientEmails,
      openAt: new Date().toISOString(),
      closeAt: null,
      solutions: "on_submit",
    }, crypto.randomUUID());
    setAssignments((current) => [created.assignment, ...current]);
    setDirectJobId("");
    setDirectEmails("");
    return `Test sent to ${recipientEmails.length} student${recipientEmails.length === 1 ? "" : "s"}`;
  });

  const archive = () => run("archive", async () => {
    if (selectedClassId === null) throw new Error("no class selected");
    await api.archiveClassroom(selectedClassId, { reason: "Archived by the class teacher" });
    await loadClasses();
    return "Class archived";
  });

  const openInsights = (assignmentId: string) => run(`insights-${assignmentId}`, async () => {
    const response = await api.getAssignmentInsights(assignmentId);
    setInsight({ assignmentId, response });
    return "Insights refreshed";
  });

  const openStudentInsights = (assignmentId: string, uid: string) => run(`student-insights-${assignmentId}-${uid}`, async () => {
    const response = await api.getStudentAssignmentInsights(assignmentId, uid);
    setInsight({ assignmentId, response });
    return "Student insights refreshed";
  });

  if (denied) {
    return (
      <section className="academic-feedback academic-feedback--error" role="alert">
        <h2>Teacher workspace unavailable</h2>
        <p>Teacher access could not be verified. Sign in again or contact an administrator.</p>
      </section>
    );
  }

  const activeClasses = classes.filter((classroom) => classroom.status === "active").length;
  const activeMembers = roster.members.filter((member) => member.status === "active").length;
  const pendingInvitations = roster.invitations.filter((invitation) => invitation.status === "pending").length;
  const aggregate = insight?.response.insights.aggregate;

  return (
    <div className="teacher-connected">
      <header className="academic-card__header">
        <div><p className="academic-overline">Classroom operations</p><h1>Teacher workspace</h1><p>Create classes, invite students by email, schedule tests, and review released results.</p></div>
      </header>
      {feedback ? (
        <p className={`academic-feedback academic-feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </p>
      ) : null}

      <section className="academic-metric-row" aria-label="Teacher overview">
        <article className="academic-metric"><p className="academic-metric__label">Active classes</p><p className="academic-metric__value">{activeClasses}</p></article>
        <article className="academic-metric"><p className="academic-metric__label">Students in class</p><p className="academic-metric__value">{activeMembers}</p></article>
        <article className="academic-metric"><p className="academic-metric__label">Pending invitations</p><p className="academic-metric__value">{pendingInvitations}</p></article>
        <article className="academic-metric"><p className="academic-metric__label">Assignments</p><p className="academic-metric__value">{assignments.length}</p></article>
      </section>

      <section aria-labelledby="teacher-classes-title" className="academic-card" hidden={section !== "#teacher-classes"} id="teacher-classes">
        <header className="academic-card__header">
          <h2 id="teacher-classes-title">Classes</h2>
        </header>
        <form
          className="academic-inline-form"
          onSubmit={(event: FormEvent) => { event.preventDefault(); void createClass(); }}
        >
          <div className="academic-field">
            <label htmlFor="teacher-new-class">New class name</label>
            <input
              id="teacher-new-class"
              maxLength={120}
              onChange={(event) => setNewClassName(event.target.value)}
              placeholder="Grade 12 Physics"
              required
              value={newClassName}
            />
          </div>
          <button className="academic-button academic-button--primary" disabled={busy !== null || newClassName.trim() === ""} type="submit">
            {busy === "create-class" ? "Creating…" : "Create class"}
          </button>
        </form>
        {loading ? <p className="academic-subtitle" role="status">Loading classes…</p> : null}
        {!loading && loadError !== null ? (
          <p className="academic-subtitle">
            {loadError}{" "}
            <button className="academic-button academic-button--quiet" onClick={() => void loadClasses()} type="button">Retry</button>
          </p>
        ) : null}
        {!loading && classes.length === 0 ? <p>No classes yet. Create one to invite students.</p> : null}
        {classes.length > 0 ? (
          <div className="academic-table-wrap"><table>
            <caption>Classes you own</caption>
            <thead><tr><th scope="col">Class</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {classes.map((classroom) => (
                <tr key={classroom.id} data-selected={classroom.id === selectedClassId ? "true" : "false"}>
                  <th scope="row">{classroom.name}</th>
                  <td><Status value={classroom.status} /></td>
                  <td>{classroom.createdAt.slice(0, 10)}</td>
                  <td>
                    <button
                      className="academic-button academic-button--quiet"
                      onClick={() => setSelectedClassId(classroom.id)}
                      type="button"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
      </section>

      <section aria-labelledby="teacher-roster-title" className="academic-card" hidden={section !== "#teacher-roster"} id="teacher-roster">
        <header className="academic-card__header">
          <h2 id="teacher-roster-title">Student roster</h2>
          <div className="academic-row-actions">
            <button
              className="academic-button academic-button--primary"
              disabled={selectedClass === null || busy !== null}
              onClick={() => setInviteOpen(true)}
              type="button"
            >
              Invite students
            </button>
            <button
              className="academic-button academic-button--quiet"
              disabled={selectedClass === null || busy !== null}
              onClick={() => void archive()}
              type="button"
            >
              {busy === "archive" ? "Archiving…" : "Archive class"}
            </button>
          </div>
        </header>
        {selectedClass === null ? <p>Select a class to view its roster.</p> : <p className="academic-subtitle">{selectedClass.name}</p>}
        {roster.members.length === 0 && roster.invitations.length === 0 && selectedClass !== null ? (
          <p>No students yet. Invite a student by email to build the roster.</p>
        ) : null}
        {roster.members.length > 0 ? (
          <div className="academic-table-wrap"><table>
            <caption>Enrolled students</caption>
            <thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Joined</th></tr></thead>
            <tbody>
              {roster.members.map((member) => (
                <tr key={member.studentUid}>
                  <th scope="row">{member.displayName ?? "Student"}</th>
                  <td><Status value={member.status} /></td>
                  <td>{member.joinedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
        {roster.invitations.length > 0 ? (
          <div className="academic-table-wrap"><table>
            <caption>Outstanding invitations</caption>
            <thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Delivery</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {roster.invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <th scope="row">{invitation.maskedEmail}</th>
                  <td><Status value={invitation.status} /></td>
                  <td><Status value={invitation.delivery} /></td>
                  <td>
                    <button
                      className="academic-button academic-button--quiet"
                      disabled={busy !== null || invitation.status !== "pending"}
                      onClick={() => void redeliver(invitation.id)}
                      type="button"
                    >
                      {busy === `redeliver-${invitation.id}` ? "Requesting…" : "Redeliver"}
                    </button>
                    <button
                      className="academic-button academic-button--quiet"
                      disabled={busy !== null || invitation.status !== "pending"}
                      onClick={() => void revoke(invitation.id)}
                      type="button"
                    >
                      {busy === `revoke-${invitation.id}` ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
      </section>

      <section aria-labelledby="teacher-assignments-title" className="academic-card" hidden={section !== "#teacher-assignments"} id="teacher-assignments">
        <header className="academic-card__header">
          <h2 id="teacher-assignments-title">Assignments</h2>
        </header>
        {selectedClass === null ? <p>Select a class to schedule a test.</p> : (
          <form className="academic-inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void assign(); }}>
            {testPicker("teacher-job-id", "Test", jobId, setJobId)}
            <button className="academic-button academic-button--primary" disabled={busy !== null || jobId.trim() === ""} type="submit">
              {busy === "assign" ? "Scheduling…" : "Assign to class"}
            </button>
          </form>
        )}
        <section aria-labelledby="teacher-direct-title" className="academic-card">
          <header className="academic-card__header">
            <h3 id="teacher-direct-title">Send a test without a class</h3>
          </header>
          <p className="academic-subtitle">Addressed straight to students by email. Each address must already have a Vijeeta student account.</p>
          <form className="academic-inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void assignDirect(); }}>
            {testPicker("teacher-direct-job", "Test to send", directJobId, setDirectJobId)}
            <div className="academic-field">
              <label htmlFor="teacher-direct-emails">Student emails</label>
              <textarea id="teacher-direct-emails" onChange={(event) => setDirectEmails(event.target.value)} placeholder="one per line, or comma separated" required rows={3} value={directEmails} />
            </div>
            <button className="academic-button academic-button--primary" disabled={busy !== null || directJobId.trim() === "" || directEmails.trim() === ""} type="submit">
              {busy === "assign-direct" ? "Sending…" : "Send test"}
            </button>
          </form>
        </section>

        {assignments.length === 0 && selectedClass !== null ? <p>No assignments scheduled for this class.</p> : null}
        {assignments.length > 0 ? (
          <div className="academic-table-wrap"><table>
            <caption>Assignments for the selected class</caption>
            <thead><tr><th scope="col">Job</th><th scope="col">State</th><th scope="col">Opens</th><th scope="col">Recipients</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <th scope="row">{assignment.jobId}</th>
                  <td><Status value={assignment.state} /></td>
                  <td>{assignment.openAt.slice(0, 10)}</td>
                  <td>{assignment.recipientCount}</td>
                  <td>
                    <button
                      className="academic-button academic-button--quiet"
                      disabled={busy !== null}
                      onClick={() => void openInsights(assignment.id)}
                      type="button"
                    >
                      {busy === `insights-${assignment.id}` ? "Loading…" : "View insights"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
      </section>

      <section aria-labelledby="teacher-insights-title" className="academic-card" hidden={section !== "#teacher-insights"} id="teacher-insights">
        <header className="academic-card__header">
          <h2 id="teacher-insights-title">Assignment insights</h2>
        </header>
        {insight === null ? <p>Choose an assignment to load its aggregate results.</p> : (
          <>
            <p className="academic-subtitle">Refreshed {insight.response.freshness.slice(0, 16).replace("T", " ")}</p>
            {aggregate ? (
              <section className="academic-metric-row" aria-label="Aggregate results">
                <article className="academic-metric"><p className="academic-metric__label">Attempted</p><p className="academic-metric__value">{aggregate.attempted}</p></article>
                <article className="academic-metric"><p className="academic-metric__label">Pending</p><p className="academic-metric__value">{aggregate.pending}</p></article>
                <article className="academic-metric"><p className="academic-metric__label">Average score</p><p className="academic-metric__value">{formatScore(aggregate.averageScore)}</p></article>
              </section>
            ) : null}
            {insight.response.insights.individual ? (
              <p>
                {insight.response.insights.individual.displayName}: {formatScore(insight.response.insights.individual.score)} ({insight.response.insights.individual.status})
              </p>
            ) : null}
            {roster.members.length > 0 ? (
              <div className="academic-table-wrap"><table>
                <caption>Individual results</caption>
                <thead><tr><th scope="col">Student</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {roster.members.map((member) => (
                    <tr key={member.studentUid}>
                      <th scope="row">{member.displayName ?? "Student"}</th>
                      <td>
                        <button
                          className="academic-button academic-button--quiet"
                          disabled={busy !== null}
                          onClick={() => void openStudentInsights(insight.assignmentId, member.studentUid)}
                          type="button"
                        >
                          {busy === `student-insights-${insight.assignmentId}-${member.studentUid}` ? "Loading…" : "View student result"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : null}
          </>
        )}
      </section>

      {inviteOpen && selectedClass !== null ? (
        <InviteDialog
          busy={busy === "invite"}
          classroomName={selectedClass.name}
          onCancel={() => setInviteOpen(false)}
          onConfirm={(email) => void invite(email)}
        />
      ) : null}
    </div>
  );
}
