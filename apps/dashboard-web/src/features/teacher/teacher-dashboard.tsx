"use client";

import { useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Metric,
  Select,
  Tabs,
  type TabItem,
} from "@vijeeta/design-system";

export type TeacherDashboardScenario = "ready" | "loading" | "empty" | "error";
export type TeacherRosterStatus = "attempted" | "not-attempted";
export type TeacherTestStatus = "draft" | "assigned" | "in-progress" | "submitted";
export type TeacherDifficulty = "Easy" | "Mixed" | "Hard";
export type TeacherInviteChannel = "email" | "whatsapp";
export type TeacherReleasePolicy = "learning-mode" | "after-test" | "scheduled";

export interface TeacherClass {
  id: string;
  name: string;
  studentCount: number;
  subject: string;
}

export interface TeacherRosterEntry {
  id: string;
  name: string;
  email: string;
  status: TeacherRosterStatus;
  score?: string;
}

export interface TeacherInvitation {
  id: string;
  recipient: string;
  channel: TeacherInviteChannel;
  state: "preview" | "created";
}

export interface TeacherTestSummary {
  id: string;
  title: string;
  topic: string;
  questionCount: number;
  difficulty: TeacherDifficulty;
  status: TeacherTestStatus;
  assignedClassId?: string;
  attemptedCount: number;
  totalStudents: number;
}

export interface TeacherIndividualInsight {
  studentId: string;
  summary: string;
}

export interface TeacherDashboardInsights {
  attemptedCount: number;
  totalStudents: number;
  averageScore: string;
  strongestTopic: string;
  students: readonly TeacherIndividualInsight[];
}

export interface TeacherDashboardSnapshot {
  scenario: TeacherDashboardScenario;
  teacher: {
    name: string;
    organisation: string;
  };
  classes: readonly TeacherClass[];
  roster: readonly TeacherRosterEntry[];
  invitations: readonly TeacherInvitation[];
  tests: readonly TeacherTestSummary[];
  insights: TeacherDashboardInsights;
}

export interface TeacherInvitationInput {
  channel: TeacherInviteChannel;
  recipient: string;
}

export interface TeacherQuickTestDraftInput {
  topic: string;
  questionCount: number;
  difficulty: TeacherDifficulty;
  durationMinutes: number;
  negativeMarking: boolean;
  releasePolicy: TeacherReleasePolicy;
}

export interface TeacherAssignmentInput {
  testId: string;
  classId: string;
  directEmailExceptions: readonly string[];
}

export interface TeacherActionResult {
  status: "preview" | "created" | "error";
  summary: string;
}

export interface TeacherDashboardProps {
  snapshot: TeacherDashboardSnapshot;
  onCreateInvitation?: (
    input: TeacherInvitationInput,
  ) => Promise<TeacherActionResult>;
  onCreateQuickTestDraft?: (
    input: TeacherQuickTestDraftInput,
  ) => Promise<TeacherActionResult>;
  onAssignTest?: (input: TeacherAssignmentInput) => Promise<TeacherActionResult>;
}

export function TeacherDashboard({
  onAssignTest,
  onCreateInvitation,
  onCreateQuickTestDraft,
  snapshot,
}: TeacherDashboardProps) {
  if (snapshot.scenario === "loading") {
    return (
      <section aria-label="Teacher dashboard" className="teacher-dashboard teacher-dashboard--state">
        <h1>Teacher dashboard</h1>
        <Alert title="Loading teacher dashboard">Preparing your classes and tests.</Alert>
      </section>
    );
  }

  if (snapshot.scenario === "error") {
    return (
      <section aria-label="Teacher dashboard" className="teacher-dashboard teacher-dashboard--state">
        <h1>Teacher dashboard</h1>
        <Alert title="We could not load the teacher dashboard" tone="danger">
          Try the fixture view again when your workspace is ready.
        </Alert>
      </section>
    );
  }

  if (snapshot.scenario === "empty" || snapshot.classes.length === 0) {
    return (
      <section aria-label="Teacher dashboard" className="teacher-dashboard teacher-dashboard--state">
        <h1>Teacher dashboard</h1>
        <EmptyState
          title="No classes yet"
          description="Create a class to invite learners and build your first test."
        />
      </section>
    );
  }

  return (
    <section aria-label="Teacher dashboard" className="teacher-dashboard">
      <header className="teacher-dashboard__header">
        <div>
          <p className="teacher-eyebrow">{snapshot.teacher.organisation}</p>
          <h1>Teacher dashboard</h1>
          <p>Good morning, {snapshot.teacher.name.split(" ")[0]}. Keep your classes moving.</p>
        </div>
        <Badge data-tone="neutral">Fixture workspace</Badge>
      </header>

      <div className="teacher-dashboard__grid">
        <div className="teacher-dashboard__primary">
          <ClassRoster classes={snapshot.classes} />
          <TeacherRoster roster={snapshot.roster} />
          <TeacherTools
            classes={snapshot.classes}
            invitations={snapshot.invitations}
            onCreateInvitation={onCreateInvitation}
            onCreateQuickTestDraft={onCreateQuickTestDraft}
            onAssignTest={onAssignTest}
            tests={snapshot.tests}
          />
        </div>
        <TeacherInsights insights={snapshot.insights} roster={snapshot.roster} />
      </div>
    </section>
  );
}

function ClassRoster({ classes }: { classes: readonly TeacherClass[] }) {
  return (
    <Card className="teacher-card teacher-classes" title="Classes and roster">
      <div className="teacher-class-list">
        {classes.map((teacherClass) => (
          <article className="teacher-class" key={teacherClass.id} aria-label={teacherClass.name}>
            <div>
              <h3>{teacherClass.name}</h3>
              <p>{teacherClass.subject}</p>
            </div>
            <Metric label="Learners" value={teacherClass.studentCount} />
          </article>
        ))}
      </div>
    </Card>
  );
}

function TeacherRoster({ roster }: { roster: readonly TeacherRosterEntry[] }) {
  const attempted = roster.filter((student) => student.status === "attempted");
  const notAttempted = roster.filter((student) => student.status === "not-attempted");

  const rosterPanel = (records: readonly TeacherRosterEntry[], emptyMessage: string) =>
    records.length > 0 ? (
      <div className="teacher-roster-list">
        {records.map((student) => (
          <article className="teacher-roster-entry" key={student.id} aria-label={student.name}>
            <div>
              <h3>{student.name}</h3>
              <p>{student.email}</p>
            </div>
            <Badge data-tone={student.status === "attempted" ? "success" : "neutral"}>
              {student.score ?? "Not attempted"}
            </Badge>
          </article>
        ))}
      </div>
    ) : (
      <p className="teacher-muted">{emptyMessage}</p>
    );

  const items: readonly TabItem[] = [
    {
      id: "attempted",
      label: "Attempted",
      panel: rosterPanel(attempted, "No learners have attempted a test yet."),
    },
    {
      id: "not-attempted",
      label: "Not attempted",
      panel: rosterPanel(notAttempted, "Everyone has made a first attempt."),
    },
  ];

  return (
    <Card className="teacher-card teacher-roster" title="Learner progress">
      <Tabs defaultTabId="attempted" items={items} label="Roster progress" />
    </Card>
  );
}

function TeacherTools({
  classes,
  invitations,
  onAssignTest,
  onCreateInvitation,
  onCreateQuickTestDraft,
  tests,
}: {
  classes: readonly TeacherClass[];
  invitations: readonly TeacherInvitation[];
  onAssignTest?: TeacherDashboardProps["onAssignTest"];
  onCreateInvitation?: TeacherDashboardProps["onCreateInvitation"];
  onCreateQuickTestDraft?: TeacherDashboardProps["onCreateQuickTestDraft"];
  tests: readonly TeacherTestSummary[];
}) {
  return (
    <div className="teacher-tools">
      <InviteForm
        invitations={invitations}
        onCreateInvitation={onCreateInvitation}
      />
      <QuickTestForm onCreateQuickTestDraft={onCreateQuickTestDraft} />
      <AssignmentPreview
        classes={classes}
        onAssignTest={onAssignTest}
        tests={tests}
      />
    </div>
  );
}

function InviteForm({
  invitations,
  onCreateInvitation,
}: {
  invitations: readonly TeacherInvitation[];
  onCreateInvitation?: TeacherDashboardProps["onCreateInvitation"];
}) {
  const [channel, setChannel] = useState<TeacherInviteChannel>("email");
  const [recipient, setRecipient] = useState("");
  const [state, setState] = useState<TeacherActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipient.trim()) {
      setState({ status: "error", summary: "Enter an email or WhatsApp recipient." });
      return;
    }
    setSubmitting(true);
    try {
      const result = onCreateInvitation
        ? await onCreateInvitation({ channel, recipient: recipient.trim() })
        : { status: "preview" as const, summary: `Preview ready for ${recipient.trim()}` };
      setState(result);
    } catch {
      setState({ status: "error", summary: "Invitation preview could not be prepared." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="teacher-card teacher-invite" title="Invite a learner">
      <form onSubmit={submit}>
        <Field label="Invite recipient" required>
          {(props) => (
            <input
              {...props}
              onChange={(event) => setRecipient(event.target.value)}
              type="text"
              value={recipient}
            />
          )}
        </Field>
        <Select
          label="Invite channel"
          onChange={(event) => setChannel(event.target.value as TeacherInviteChannel)}
          options={[
            { value: "email", label: "Email preview" },
            { value: "whatsapp", label: "WhatsApp preview" },
          ]}
          value={channel}
        />
        <p className="teacher-help">Preview only. No invitation is sent from fixture mode.</p>
        <Button loading={submitting} loadingLabel="Preparing preview" type="submit">
          Preview invitation
        </Button>
      </form>
      {state ? (
        <Alert title="Invitation state" tone={state.status === "error" ? "danger" : "success"}>
          {state.summary}. <span>No invitation was sent.</span>
        </Alert>
      ) : null}
      {invitations.length > 0 ? (
        <p className="teacher-help">{invitations.length} existing invitation preview(s).</p>
      ) : null}
    </Card>
  );
}

function QuickTestForm({
  onCreateQuickTestDraft,
}: {
  onCreateQuickTestDraft?: TeacherDashboardProps["onCreateQuickTestDraft"];
}) {
  const [topic, setTopic] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<TeacherDifficulty>("Mixed");
  const [moreSettings, setMoreSettings] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [negativeMarking, setNegativeMarking] = useState(false);
  const [releasePolicy, setReleasePolicy] = useState<TeacherReleasePolicy>("after-test");
  const [state, setState] = useState<TeacherActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic.trim()) {
      setState({ status: "error", summary: "Enter a test topic." });
      return;
    }
    setSubmitting(true);
    try {
      const result = onCreateQuickTestDraft
        ? await onCreateQuickTestDraft({
            difficulty,
            durationMinutes,
            negativeMarking,
            questionCount,
            releasePolicy,
            topic: topic.trim(),
          })
        : { status: "created" as const, summary: `${topic.trim()} draft ready` };
      setState(result);
    } catch {
      setState({ status: "error", summary: "Quick test draft could not be created." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="teacher-card teacher-quick-test" title="Quick-create a test">
      <form onSubmit={submit}>
        <Field label="Test topic" required>
          {(props) => (
            <input
              {...props}
              onChange={(event) => setTopic(event.target.value)}
              type="text"
              value={topic}
            />
          )}
        </Field>
        <Field label="Question count" required>
          {(props) => (
            <input
              {...props}
              min={1}
              onChange={(event) => setQuestionCount(Number(event.target.value))}
              type="number"
              value={questionCount}
            />
          )}
        </Field>
        <Select
          label="Difficulty"
          onChange={(event) => setDifficulty(event.target.value as TeacherDifficulty)}
          options={[
            { value: "Easy", label: "Easy" },
            { value: "Mixed", label: "Mixed" },
            { value: "Hard", label: "Hard" },
          ]}
          value={difficulty}
        />
        <Button
          aria-controls="teacher-more-settings"
          aria-expanded={moreSettings}
          className="teacher-more-settings-toggle"
          onClick={() => setMoreSettings((open) => !open)}
          variant="secondary"
        >
          {moreSettings ? "Hide more settings" : "More settings"}
        </Button>
        {moreSettings ? (
          <div className="teacher-more-settings" id="teacher-more-settings">
            <Field label="Duration (minutes)" required>
              {(props) => (
                <input
                  {...props}
                  min={1}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  type="number"
                  value={durationMinutes}
                />
              )}
            </Field>
            <Checkbox
              checked={negativeMarking}
              label="Negative marking"
              onChange={(event) => setNegativeMarking(event.target.checked)}
            />
            <Select
              label="Release policy"
              onChange={(event) => setReleasePolicy(event.target.value as TeacherReleasePolicy)}
              options={[
                { value: "after-test", label: "After the test" },
                { value: "learning-mode", label: "As students learn" },
                { value: "scheduled", label: "On a chosen date" },
              ]}
              value={releasePolicy}
            />
          </div>
        ) : null}
        <Button loading={submitting} loadingLabel="Creating draft" type="submit">
          Create quick test draft
        </Button>
      </form>
      {state ? (
        <Alert title="Quick test state" tone={state.status === "error" ? "danger" : "success"}>
          {state.summary}
        </Alert>
      ) : null}
    </Card>
  );
}

function AssignmentPreview({
  classes,
  onAssignTest,
  tests,
}: {
  classes: readonly TeacherClass[];
  onAssignTest?: TeacherDashboardProps["onAssignTest"];
  tests: readonly TeacherTestSummary[];
}) {
  const firstTest = tests[0];
  const [testId, setTestId] = useState(firstTest?.id ?? "");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [exceptions, setExceptions] = useState("");
  const [state, setState] = useState<TeacherActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const directEmailExceptions = exceptions
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    setSubmitting(true);
    try {
      const result = onAssignTest
        ? await onAssignTest({ classId, directEmailExceptions, testId })
        : { status: "preview" as const, summary: "Assignment preview ready" };
      setState(result);
    } catch {
      setState({ status: "error", summary: "Assignment preview could not be prepared." });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedClass = classes.find((teacherClass) => teacherClass.id === classId);
  const selectedTest = tests.find((test) => test.id === testId);

  return (
    <Card className="teacher-card teacher-assignment" title="Assign a test">
      {tests.length === 0 ? (
        <p className="teacher-muted">Create a test draft before assigning it.</p>
      ) : (
        <form onSubmit={submit}>
          <Select
            label="Test to assign"
            onChange={(event) => setTestId(event.target.value)}
            options={tests.map((test) => ({ value: test.id, label: test.title }))}
            value={testId}
          />
          <Select
            label="Assignment class"
            onChange={(event) => setClassId(event.target.value)}
            options={classes.map((teacherClass) => ({
              value: teacherClass.id,
              label: teacherClass.name,
            }))}
            value={classId}
          />
          <Field
            label="Direct email exceptions"
            support="Optional comma-separated addresses for learners outside the class roster."
          >
            {(props) => (
              <input
                {...props}
                onChange={(event) => setExceptions(event.target.value)}
                type="text"
                value={exceptions}
              />
            )}
          </Field>
          <div className="teacher-assignment-summary">
            <p>
              <strong>Assignment preview</strong>
            </p>
            <p>Class: {selectedClass?.name ?? "Choose a class"}</p>
            <p>Test: {selectedTest?.title ?? "Choose a test"}</p>
            <p>Direct email exceptions: {countEmails(exceptions)}</p>
          </div>
          <Button loading={submitting} loadingLabel="Preparing assignment" type="submit">
            Preview assignment
          </Button>
        </form>
      )}
      {state ? (
        <Alert title="Assignment state" tone={state.status === "error" ? "danger" : "success"}>
          {state.summary}
        </Alert>
      ) : null}
    </Card>
  );
}

function TeacherInsights({
  insights,
  roster,
}: {
  insights: TeacherDashboardInsights;
  roster: readonly TeacherRosterEntry[];
}) {
  const namesById = new Map(roster.map((student) => [student.id, student.name]));

  return (
    <aside className="teacher-dashboard__insights">
      <Card className="teacher-card teacher-insights" title="Class insights">
        <Alert title="Class insight" tone="success">
          {insights.attemptedCount} of {insights.totalStudents} attempted · average {insights.averageScore}
        </Alert>
        <Metric label="Strongest topic" value={insights.strongestTopic} />
        <h3>Individual insights</h3>
        <div className="teacher-individual-insights">
          {insights.students.map((insight) => (
            <div
              aria-label={namesById.get(insight.studentId) ?? insight.studentId}
              className="teacher-individual-insight"
              key={insight.studentId}
            >
              <strong>{namesById.get(insight.studentId) ?? insight.studentId}</strong>
              <p>{insight.summary}</p>
            </div>
          ))}
        </div>
      </Card>
    </aside>
  );
}

function countEmails(value: string): number {
  return value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean).length;
}
