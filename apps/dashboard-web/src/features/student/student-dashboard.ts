"use client";

import { Alert, Badge, Card, Metric } from "@vijeeta/design-system";
import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";

export type StudentDashboardStatus = "ready" | "loading" | "empty" | "error";
export type StudentTestStatus =
  | "pending"
  | "assigned"
  | "in-progress"
  | "attempted"
  | "submitted";

export interface StudentClass {
  id: string;
  name: string;
  subject?: string;
  teacherName?: string;
}

export interface StudentTestResult {
  score: number;
  totalMarks: number;
  summary?: string;
}

export interface StudentTest {
  id: string;
  title: string;
  status: StudentTestStatus;
  classId?: string;
  subject?: string;
  dueAt?: string;
  durationMinutes?: number;
  questionCount?: number;
  score?: number;
  totalMarks?: number;
  resultSummary?: string;
  result?: StudentTestResult;
}

export interface StudentInsights {
  testsCompleted: number;
  averageScore: string;
  focusArea: string;
}

export interface StudentDashboardSnapshot {
  status: StudentDashboardStatus;
  student: { id: string; name: string; grade?: string };
  classes: readonly StudentClass[];
  tests: readonly StudentTest[];
  selectedTestId?: string;
  insights: StudentInsights;
}

export interface StudentDashboardProps {
  snapshot: StudentDashboardSnapshot;
  onStartAttempt: (testId: string) => Promise<void>;
  onSubmitAttempt: (testId: string) => Promise<void>;
}

type LocalTestStatuses = Readonly<Record<string, StudentTestStatus>>;
type BusyAction = { kind: "start" | "submit"; testId: string } | null;
type Element = ReturnType<typeof createElement>;

const groupDefinitions: readonly {
  id: string;
  title: string;
  statuses: readonly StudentTestStatus[];
}[] = [
  { id: "assigned", title: "Assigned tests", statuses: ["assigned"] },
  { id: "pending", title: "Pending tests", statuses: ["pending"] },
  {
    id: "attempted",
    title: "Attempted tests",
    statuses: ["in-progress", "attempted", "submitted"],
  },
] as const;

export function StudentDashboard({
  onStartAttempt,
  onSubmitAttempt,
  snapshot,
}: StudentDashboardProps): Element {
  const [localStatuses, setLocalStatuses] = useState<LocalTestStatuses>(() =>
    toStatusMap(snapshot.tests),
  );
  const [selectedTestId, setSelectedTestId] = useState(
    snapshot.selectedTestId ?? snapshot.tests[0]?.id,
  );
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    setLocalStatuses(toStatusMap(snapshot.tests));
    setSelectedTestId(snapshot.selectedTestId ?? snapshot.tests[0]?.id);
    setActionError(undefined);
  }, [snapshot]);

  const tests = useMemo(
    () =>
      snapshot.tests.map((test) => ({
        ...test,
        status: localStatuses[test.id] ?? test.status,
      })),
    [localStatuses, snapshot.tests],
  );
  const selectedTest = tests.find((test) => test.id === selectedTestId) ?? tests[0];

  if (snapshot.status === "loading") {
    return createElement(
      "div",
      { className: "student-dashboard student-dashboard--loading", "data-status": "loading" },
      createElement(
        "p",
        { "aria-label": "Loading your student dashboard", role: "status" },
        "Loading your student dashboard",
      ),
    );
  }

  if (snapshot.status === "empty") {
    return createElement(
      "div",
      { className: "student-dashboard student-dashboard--empty", "data-status": "empty" },
      createElement(
        "div",
        { "aria-label": "No tests assigned yet", role: "status" },
        createElement("h1", null, "No tests assigned yet"),
        createElement("p", null, "Your next class test will appear here when your teacher assigns it."),
      ),
    );
  }

  if (snapshot.status === "error") {
    return createElement(
      "div",
      { className: "student-dashboard student-dashboard--error", "data-status": "error" },
      createElement(
        Alert,
        {
          children: "Try again in a moment. Your saved attempt data is unchanged.",
          title: "We could not load your student dashboard",
          tone: "danger",
        },
      ),
    );
  }

  return createElement(
    "div",
    { className: "student-dashboard", "data-status": "ready" },
    createElement(
      "header",
      { className: "student-dashboard__header" },
      createElement(
        "div",
        null,
        createElement("p", { className: "student-dashboard__eyebrow" }, "Student dashboard"),
        createElement("h1", null, `Welcome, ${firstName(snapshot.student.name)}`),
        snapshot.student.grade ? createElement("p", null, snapshot.student.grade) : null,
      ),
    ),
    renderClasses(snapshot.classes),
    renderTestGroups(
      tests,
      selectedTest,
      setSelectedTestId,
    ),
    selectedTest
      ? createElement(TestDetail, {
          actionError,
          busyAction,
          onStart: async () => {
            setBusyAction({ kind: "start", testId: selectedTest.id });
            setActionError(undefined);
            try {
              await onStartAttempt(selectedTest.id);
              setLocalStatuses((current) => ({ ...current, [selectedTest.id]: "in-progress" }));
            } catch {
              setActionError("We could not start this attempt. Try again.");
            } finally {
              setBusyAction(null);
            }
          },
          onSubmit: async () => {
            setBusyAction({ kind: "submit", testId: selectedTest.id });
            setActionError(undefined);
            try {
              await onSubmitAttempt(selectedTest.id);
              setLocalStatuses((current) => ({ ...current, [selectedTest.id]: "submitted" }));
            } catch {
              setActionError("We could not submit this attempt. Try again.");
            } finally {
              setBusyAction(null);
            }
          },
          test: selectedTest,
        })
      : null,
    createElement(
      "section",
      { "aria-labelledby": "student-insights-title", className: "student-dashboard__section" },
      createElement("h2", { id: "student-insights-title" }, "Personal insights"),
      createElement(
        "div",
        { className: "student-insight-grid" },
        createElement(Metric, { label: "Tests completed", value: snapshot.insights.testsCompleted }),
        createElement(Metric, { label: "Average score", value: snapshot.insights.averageScore }),
        createElement(Metric, { label: "Focus area", value: snapshot.insights.focusArea }),
      ),
    ),
  );
}

function renderClasses(classes: readonly StudentClass[]): Element {
  return createElement(
    "section",
    { "aria-labelledby": "student-classes-title", className: "student-dashboard__section" },
    createElement("h2", { id: "student-classes-title" }, "My classes"),
    classes.length > 0
      ? createElement(
          "ul",
          { className: "student-class-list" },
          classes.map((studentClass) =>
            createElement(
              "li",
              { className: "student-class-card", key: studentClass.id },
              createElement("h3", null, studentClass.name),
              studentClass.subject ? createElement("p", null, studentClass.subject) : null,
              studentClass.teacherName
                ? createElement("p", null, `Teacher: ${studentClass.teacherName}`)
                : null,
            ),
          ),
        )
      : createElement("p", null, "No classes yet."),
  );
}

function renderTestGroups(
  tests: readonly StudentTest[],
  selectedTest: StudentTest | undefined,
  setSelectedTestId: (testId: string) => void,
): Element {
  return createElement(
    "section",
    { "aria-labelledby": "student-tests-title", className: "student-dashboard__section" },
    createElement("h2", { id: "student-tests-title" }, "My tests"),
    createElement(
      "div",
      { className: "student-test-groups" },
      groupDefinitions.map((group) => {
        const groupedTests = tests.filter((test) => group.statuses.includes(test.status));
        return createElement(
          "section",
          { "aria-labelledby": `student-${group.id}-tests-title`, key: group.id },
          createElement("h3", { id: `student-${group.id}-tests-title` }, group.title),
          groupedTests.length > 0
            ? createElement(
                "ul",
                { className: "student-test-list" },
                groupedTests.map((test) =>
                  createElement(
                    "li",
                    { key: test.id },
                    createElement(
                      "button",
                      {
                        "aria-pressed": selectedTest?.id === test.id,
                        className: "student-test-select",
                        onClick: () => setSelectedTestId(test.id),
                        type: "button",
                      },
                      createElement("span", null, test.title),
                      createElement(Badge, null, statusLabel(test.status)),
                    ),
                  ),
                ),
              )
            : createElement("p", { className: "student-test-group-empty" }, "Nothing here yet."),
        );
      }),
    ),
  );
}

function TestDetail({
  actionError,
  busyAction,
  onStart,
  onSubmit,
  test,
}: {
  actionError?: string;
  busyAction: BusyAction;
  onStart: () => Promise<void>;
  onSubmit: () => Promise<void>;
  test: StudentTest;
}): Element {
  const result = resolveResult(test);
  const detail: ReactNode[] = [
    createElement(
      "p",
      { className: "student-test-detail__status", key: "status" },
      "Status: ",
      createElement("strong", null, statusLabel(test.status)),
    ),
    test.subject ? createElement("p", { key: "subject" }, test.subject) : null,
    test.dueAt ? createElement("p", { key: "due" }, `Due: ${test.dueAt}`) : null,
    test.durationMinutes !== undefined || test.questionCount !== undefined
      ? createElement(
          "p",
          { key: "meta" },
          test.durationMinutes !== undefined ? `${test.durationMinutes} minutes` : null,
          test.durationMinutes !== undefined && test.questionCount !== undefined ? " · " : null,
          test.questionCount !== undefined ? `${test.questionCount} questions` : null,
        )
      : null,
    actionError
      ? createElement(
          Alert,
          {
            children: actionError,
            key: "error",
            title: "Action not completed",
            tone: "danger",
          },
        )
      : null,
  ];

  if (test.status === "assigned") {
    detail.push(
      createElement(
        "button",
        {
          className: "student-test-action vjt-button vjt-button--primary",
          disabled: busyAction?.testId === test.id,
          key: "start",
          onClick: () => void onStart(),
          type: "button",
        },
        busyAction?.kind === "start" && busyAction.testId === test.id ? "Starting…" : "Start test",
      ),
    );
  }
  if (test.status === "in-progress") {
    detail.push(
      createElement(
        "button",
        {
          className: "student-test-action vjt-button vjt-button--primary",
          disabled: busyAction?.testId === test.id,
          key: "submit",
          onClick: () => void onSubmit(),
          type: "button",
        },
        busyAction?.kind === "submit" && busyAction.testId === test.id
          ? "Submitting…"
          : "Submit attempt",
      ),
    );
  }
  if (test.status === "submitted" || test.status === "attempted") {
    detail.push(
      createElement(
        "div",
        { className: "student-test-result", key: "result", role: "status" },
        result
          ? createElement("p", null, `Result: ${result.score} of ${result.totalMarks}`)
          : createElement("p", null, "Result will appear here when your teacher releases it."),
        result?.summary ? createElement("p", null, result.summary) : null,
      ),
    );
  }

  return createElement(Card, {
    children: detail,
    className: "student-test-detail",
    title: test.title,
  });
}

function toStatusMap(tests: readonly StudentTest[]): LocalTestStatuses {
  return Object.fromEntries(tests.map((test) => [test.id, test.status]));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function statusLabel(status: StudentTestStatus): string {
  if (status === "in-progress") return "In progress";
  if (status === "submitted") return "Submitted";
  if (status === "attempted") return "Attempted";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function resolveResult(test: StudentTest): StudentTestResult | undefined {
  if (test.result) return test.result;
  if (test.score !== undefined && test.totalMarks !== undefined) {
    return { score: test.score, totalMarks: test.totalMarks, summary: test.resultSummary };
  }
  return undefined;
}
