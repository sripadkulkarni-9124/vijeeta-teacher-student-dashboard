"use client";

import type { DashboardSnapshot } from "@vijeeta/api-contracts";
import { Alert, Button } from "@vijeeta/design-system";
import { useEffect, useRef, useState } from "react";

import { demoApi, type DemoApi } from "@/client/demo-api";
import { toStudentView, toTeacherView } from "@/client/view-models";
import { StudentDashboard } from "@/features/student/student-dashboard";
import { TeacherDashboard } from "@/features/teacher/teacher-dashboard";
import { RoleLanding } from "./role-landing";

export function DashboardPrototype({ api = demoApi }: { api?: DemoApi }) {
  const [role, setRole] = useState<"teacher" | "student" | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const attemptIds = useRef(new Map<string, string>());

  useEffect(() => {
    const savedRole = localStorage.getItem("vijeeta-dashboard-role");
    if (savedRole === "teacher" || savedRole === "student") setRole(savedRole);
  }, []);

  useEffect(() => {
    if (!role) {
      setSnapshot(null);
      setState("idle");
      return;
    }
    let active = true;
    setState("loading");
    void api.snapshot(role).then(
      (next) => {
        if (!active) return;
        setSnapshot(next);
        setState("ready");
      },
      () => {
        if (active) setState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [api, role]);

  async function refresh(activeRole: "teacher" | "student") {
    const next = await api.snapshot(activeRole);
    setSnapshot(next);
    setState("ready");
  }

  function selectRole(nextRole: "teacher" | "student") {
    localStorage.setItem("vijeeta-dashboard-role", nextRole);
    setRole(nextRole);
  }

  function clearRole() {
    localStorage.removeItem("vijeeta-dashboard-role");
    setRole(null);
  }

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to dashboard
      </a>
      <header className="app-header">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">V</span>
          <div>
            <strong>Vijeeta</strong>
            <div className="api-status">Local end-to-end prototype</div>
          </div>
        </div>
        {role ? (
          <div>
            <span className="role-pill">
              {role === "teacher" ? "Teacher workspace" : "Student workspace"}
            </span>
            <Button onClick={clearRole} variant="secondary">
              Switch role
            </Button>
          </div>
        ) : null}
      </header>
      <main className="app-main" id="main-content">
        {role ? (
          <section aria-live="polite">
            {state === "loading" ? (
              <Alert title="Loading local workspace">Reading the local demo API.</Alert>
            ) : null}
            {state === "error" ? (
              <Alert title="Local API unavailable" tone="danger">
                Start the demo server and try switching roles again.
              </Alert>
            ) : null}
            {state === "ready" && snapshot?.role === "teacher" ? (
              <>
                <span className="role-pill">Local API connected</span>
                <TeacherDashboard
                  snapshot={toTeacherView(snapshot)}
                  onCreateInvitation={async ({ channel, recipient }) => {
                    if (channel === "whatsapp") {
                      return {
                        status: "preview",
                        summary: `WhatsApp preview ready for ${recipient}`,
                      };
                    }
                    await api.mutate({
                      type: "invite-student",
                      email: recipient,
                      classId: snapshot.classes[0]?.id ?? "",
                    });
                    await refresh("teacher");
                    return { status: "created", summary: `Invite saved for ${recipient}` };
                  }}
                  onCreateQuickTestDraft={async (input) => {
                    await api.mutate({
                      type: "create-quick-test",
                      topic: input.topic,
                      questionCount: input.questionCount,
                      difficulty: input.difficulty.toLowerCase() as "easy" | "mixed" | "hard",
                      durationMinutes: input.durationMinutes,
                      negativeMarking: input.negativeMarking,
                      releasePolicy:
                        input.releasePolicy === "scheduled"
                          ? { kind: "scheduled", releaseAt: new Date(Date.now() + 86_400_000).toISOString() }
                          : input.releasePolicy,
                    });
                    await refresh("teacher");
                    return { status: "created", summary: `${input.topic} draft saved locally` };
                  }}
                  onAssignTest={async (input) => {
                    const test = snapshot.quickTests.find((entry) => entry.id === input.testId);
                    await api.mutate({
                      type: "create-assignment",
                      testId: input.testId,
                      title: test ? `${test.topic} quick test` : "Class test",
                      classIds: [input.classId],
                      directEmails: [...input.directEmailExceptions],
                    });
                    await refresh("teacher");
                    return { status: "created", summary: "Assignment saved locally" };
                  }}
                />
              </>
            ) : null}
            {state === "ready" && snapshot?.role === "student" ? (
              <>
                <span className="role-pill">Local API connected</span>
                <StudentDashboard
                  snapshot={toStudentView(snapshot)}
                  onStartAttempt={async (assignmentId) => {
                    const result = await api.mutate({ type: "start-attempt", assignmentId });
                    if (result.type !== "attempt-started") {
                      throw new Error("Local API returned an unexpected attempt result");
                    }
                    attemptIds.current.set(assignmentId, result.attempt.id);
                    await refresh("student");
                  }}
                  onSubmitAttempt={async (assignmentId, responses) => {
                    const current = snapshot.attempts.find(
                      (attempt) => attempt.assignmentId === assignmentId && attempt.status === "in-progress",
                    );
                    const attemptId = attemptIds.current.get(assignmentId) ?? current?.id;
                    if (!attemptId) throw new Error("Start the attempt before submitting");
                    await api.mutate({
                      type: "submit-attempt",
                      attemptId,
                      responses: [...responses],
                    });
                    await refresh("student");
                  }}
                />
              </>
            ) : null}
          </section>
        ) : (
          <RoleLanding onSelectRole={selectRole} />
        )}
      </main>
    </div>
  );
}
