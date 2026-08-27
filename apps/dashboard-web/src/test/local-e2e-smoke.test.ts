import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
  createDemoServiceForTests,
} from "../../dev-fixture/app/api/demo/route";
import { toStudentView } from "@/client/view-models";
import { DashboardService } from "@/server/service";
import { DashboardStore } from "@/server/store";

afterEach(() => {
  delete (globalThis as { __vijeetaDashboardService?: DashboardService })
    .__vijeetaDashboardService;
});

describe("local dashboard end-to-end smoke", () => {
  it("persists teacher setup, student attempt, and both insight reads through HTTP handlers", async () => {
    const statePath = join(
      await mkdtemp(join(tmpdir(), "vijeeta-e2e-")),
      "dashboard-state.json",
    );
    createDemoServiceForTests(
      new DashboardService(
        new DashboardStore({
          filePath: statePath,
          now: () => "2026-08-27T12:00:00.000Z",
        }),
      ),
    );

    const teacherBefore = await getSnapshot("teacher");
    expect(teacherBefore.session.role).toBe("teacher");

    await postAction({
      type: "invite-student",
      email: "new.student@example.test",
      classId: teacherBefore.classes[0].id,
    });
    const quickTest = await postAction({
      type: "create-quick-test",
      topic: "Vectors",
      questionCount: 6,
      difficulty: "mixed",
      durationMinutes: 20,
      negativeMarking: false,
      releasePolicy: "after-test",
    });
    const assignment = await postAction({
      type: "create-assignment",
      testId: quickTest.draft.id,
      title: "Vectors quick test",
      classIds: [teacherBefore.classes[0].id],
      directEmails: ["direct.exception@example.test"],
    });

    const teacherAfterSetup = await getSnapshot("teacher");
    expect(teacherAfterSetup.invites).toEqual([
      expect.objectContaining({ email: "new.student@example.test", status: "pending" }),
    ]);
    expect(assignment.assignment.recipients).toHaveLength(2);

    const studentBefore = await getSnapshot("student");
    expect(studentBefore.session.role).toBe("student");
    expect(studentBefore.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: assignment.assignment.id }),
      ]),
    );
    expect(toStudentView(studentBefore).tests.find(
      (test) => test.id === assignment.assignment.id,
    )?.status).toBe("assigned");

    const started = await postAction({
      type: "start-attempt",
      assignmentId: assignment.assignment.id,
    });
    const submitted = await postAction({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: started.attempt.questions.map((question: { id: string; choices: Array<{ id: string }> }, index: number) => ({
        questionId: question.id,
        selectedChoiceId: question.choices[index % question.choices.length].id,
      })),
    });
    expect(submitted.result.score).toBeGreaterThan(0);

    const studentAfter = await getSnapshot("student");
    const teacherAfter = await getSnapshot("teacher");
    expect(studentAfter.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: started.attempt.id, released: true }),
      ]),
    );
    expect(studentAfter.insights.personal.attempted).toBeGreaterThan(1);
    expect(teacherAfter.insights.aggregate.attempted).toBe(1);
    expect(teacherAfter.insights.aggregate.attempted).toBeLessThanOrEqual(
      teacherAfter.classes.flatMap((entry: { roster: unknown[] }) => entry.roster).length,
    );
  });
});

async function getSnapshot(role: "teacher" | "student") {
  const response = await GET(new Request(`http://localhost/api/demo?role=${role}`));
  expect(response.status).toBe(200);
  return response.json();
}

async function postAction(action: Record<string, unknown>) {
  const response = await POST(
    new Request("http://localhost/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    }),
  );
  expect(response.status).toBe(201);
  return response.json();
}
