import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CaptureTestEngineAdapter,
  DashboardStore,
} from "./store";

async function tempStatePath() {
  return join(await mkdtemp(join(tmpdir(), "vijeeta-dashboard-")), "state.json");
}

describe("DashboardStore", () => {
  it("rejects corrupt or incompatible persisted state with a recovery hint", async () => {
    const filePath = await tempStatePath();
    await writeFile(filePath, JSON.stringify({ version: 99, assignments: [] }), "utf8");

    await expect(new DashboardStore({ filePath }).snapshot("student"))
      .rejects.toThrow("Remove the local state file to reset the demo");
  });

  it("generates the requested number of deterministic, answerable fixture questions", async () => {
    const engine = new CaptureTestEngineAdapter();

    const questions = await engine.generateQuestions({
      topic: "Vector Motion",
      questionCount: 3,
      difficulty: "mixed",
    });

    expect(questions).toHaveLength(3);
    expect(questions[0]).toEqual(expect.objectContaining({
      id: "question-vector-motion-1",
      choices: [
        { id: "choice-vector-motion-1-a", label: "Option A" },
        { id: "choice-vector-motion-1-b", label: "Option B" },
        { id: "choice-vector-motion-1-c", label: "Option C" },
        { id: "choice-vector-motion-1-d", label: "Option D" },
      ],
    }));
    expect(engine.answerKeys).toEqual({
      "question-vector-motion-1": "choice-vector-motion-1-a",
      "question-vector-motion-2": "choice-vector-motion-2-b",
      "question-vector-motion-3": "choice-vector-motion-3-c",
    });
  });

  it("seeds enough assignments to demonstrate attempted, assigned, and pending student states", async () => {
    const store = new DashboardStore({ filePath: await tempStatePath() });
    const snapshot = await store.snapshot("student");

    expect(snapshot.assignments.map((assignment) => assignment.title)).toEqual([
      "Physics foundations check",
      "Motion foundations",
      "Units revision",
    ]);
  });

  it("upgrades an earlier local fixture store without discarding saved state", async () => {
    const filePath = await tempStatePath();
    const firstStore = new DashboardStore({ filePath });
    await firstStore.snapshot("student");
    const earlier = JSON.parse(await readFile(filePath, "utf8"));
    earlier.assignments = earlier.assignments.slice(0, 1);
    await writeFile(filePath, JSON.stringify(earlier), "utf8");

    const upgraded = await new DashboardStore({ filePath }).snapshot("student");
    expect(upgraded.assignments).toHaveLength(3);
    expect(upgraded.assignments[0].id).toBe("assignment-physics-foundations-01");
  });

  it("persists a quick test and assignment through an injected state path", async () => {
    const filePath = await tempStatePath();
    const store = new DashboardStore({ filePath, now: () => "2026-08-27T00:00:00.000Z" });

    await store.dispatch({
      type: "create-quick-test",
      topic: "Kinematics",
      questionCount: 8,
      difficulty: "hard",
      durationMinutes: 30,
      negativeMarking: true,
      releasePolicy: "after-test",
    });
    const assignment = await store.dispatch({
      type: "create-assignment",
      testId: "draft-kinematics-1",
      title: "Kinematics check",
      classIds: ["class-aurora-physics"],
      directEmails: ["guardian@example.com"],
    });

    expect(assignment.type).toBe("assignment-created");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.quickTests).toHaveLength(2);
    expect(persisted.assignments.at(-1).recipients).toEqual([
      expect.objectContaining({ kind: "class", id: "class-aurora-physics", status: "pending" }),
      expect.objectContaining({ kind: "email", email: "guardian@example.com", status: "pending" }),
    ]);
  });

  it("supports a student attempt from start through submitted result", async () => {
    const store = new DashboardStore({ filePath: await tempStatePath(), now: () => "2026-08-27T00:00:00.000Z" });
    const started = await store.dispatch({ type: "start-attempt", assignmentId: "assignment-motion-foundations-02" });
    expect(started.type).toBe("attempt-started");

    if (started.type !== "attempt-started") throw new Error("expected attempt");
    const submitted = await store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: [
        { questionId: "question-kinematics-01", selectedChoiceId: "choice-a" },
        { questionId: "question-units-01", selectedChoiceId: "choice-b" },
      ],
    });
    expect(submitted.type).toBe("attempt-submitted");
    if (submitted.type !== "attempt-submitted") throw new Error("expected result");
    expect(submitted.result.score).toBeGreaterThan(0);
  });

  it("counts distinct submitted roster students and never exceeds the eligible roster", async () => {
    const filePath = await tempStatePath();
    const store = new DashboardStore({ filePath });
    await store.snapshot("teacher");
    const state = JSON.parse(await readFile(filePath, "utf8"));
    state.attempts.push({
      ...state.attempts[0],
      id: "attempt-aarav-duplicate-submission",
      assignmentId: "assignment-motion-foundations-02",
    });
    await writeFile(filePath, JSON.stringify(state), "utf8");

    const snapshot = await store.snapshot("teacher");
    expect(snapshot.insights.aggregate).toEqual(expect.objectContaining({
      attempted: 1,
      pending: 0,
    }));
    expect(snapshot.insights.aggregate.attempted).toBeLessThanOrEqual(
      snapshot.classes.flatMap((entry) => entry.roster).length,
    );
  });

  it("rejects assignments for unknown classes or tests without questions", async () => {
    const filePath = await tempStatePath();
    const store = new DashboardStore({
      filePath,
      testEngine: { generateQuestions: async () => [] },
    });
    await store.dispatch({ type: "create-quick-test", topic: "Empty", questionCount: 2, difficulty: "easy", durationMinutes: 10, negativeMarking: false, releasePolicy: "after-test" });

    await expect(store.dispatch({
      type: "create-assignment",
      testId: "draft-empty-1",
      title: "Empty test",
      classIds: ["class-does-not-exist"],
      directEmails: [],
    })).rejects.toMatchObject({ code: "not_found" });
    await expect(store.dispatch({
      type: "create-assignment",
      testId: "draft-empty-1",
      title: "Empty test",
      classIds: ["class-aurora-physics"],
      directEmails: [],
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("prevents duplicate attempts and rejects invalid or repeated submissions", async () => {
    const store = new DashboardStore({ filePath: await tempStatePath() });
    await expect(store.dispatch({ type: "start-attempt", assignmentId: "assignment-does-not-exist" }))
      .rejects.toMatchObject({ code: "not_found" });
    const started = await store.dispatch({ type: "start-attempt", assignmentId: "assignment-motion-foundations-02" });
    if (started.type !== "attempt-started") throw new Error("expected attempt");

    await expect(store.dispatch({ type: "start-attempt", assignmentId: "assignment-motion-foundations-02" }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: [
        { questionId: "question-kinematics-01", selectedChoiceId: "choice-a" },
        { questionId: "question-kinematics-01", selectedChoiceId: "choice-a" },
      ],
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: [{ questionId: "question-not-in-attempt", selectedChoiceId: "choice-a" }],
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: [{ questionId: "question-kinematics-01", selectedChoiceId: "not-a-choice" }],
    })).rejects.toMatchObject({ code: "conflict" });

    await expect(store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: [{ questionId: "question-kinematics-01", selectedChoiceId: "choice-a" }],
    })).rejects.toMatchObject({ code: "conflict" });

    await store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: (started.attempt.questions ?? []).map((question) => ({
        questionId: question.id,
        selectedChoiceId: question.choices[0].id,
      })),
    });
    await expect(store.dispatch({
      type: "submit-attempt",
      attemptId: started.attempt.id,
      responses: (started.attempt.questions ?? []).map((question) => ({
        questionId: question.id,
        selectedChoiceId: question.choices[0].id,
      })),
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("holds scheduled results out of student snapshots until their release time", async () => {
    const filePath = await tempStatePath();
    let currentTime = "2026-08-27T12:00:00.000Z";
    const store = new DashboardStore({ filePath, now: () => currentTime });
    const created = await store.dispatch({
      type: "create-quick-test",
      topic: "Scheduled vectors",
      questionCount: 1,
      difficulty: "easy",
      durationMinutes: 10,
      negativeMarking: false,
      releasePolicy: { kind: "scheduled", releaseAt: "2026-08-28T12:00:00.000Z" },
    });
    if (created.type !== "quick-test-created") throw new Error("expected quick test");
    const assigned = await store.dispatch({ type: "create-assignment", testId: created.draft.id, title: "Scheduled vectors", classIds: ["class-aurora-physics"], directEmails: [] });
    if (assigned.type !== "assignment-created") throw new Error("expected assignment");
    const started = await store.dispatch({ type: "start-attempt", assignmentId: assigned.assignment.id });
    if (started.type !== "attempt-started") throw new Error("expected attempt");
    const question = started.attempt.questions?.[0];
    if (!question) throw new Error("expected generated question");
    await store.dispatch({ type: "submit-attempt", attemptId: started.attempt.id, responses: [{ questionId: question.id, selectedChoiceId: question.choices[0].id }] });

    expect((await store.snapshot("student")).results.some((result) => result.attemptId === started.attempt.id)).toBe(false);
    currentTime = "2026-08-28T12:00:00.000Z";
    expect((await store.snapshot("student")).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: started.attempt.id, released: true }),
    ]));
  });

  it("captures messaging and test-engine interactions without external calls", async () => {
    const messages: string[] = [];
    const generated: string[] = [];
    const store = new DashboardStore({
      filePath: await tempStatePath(),
      now: () => "2026-08-27T00:00:00.000Z",
      messaging: { sendInvite: async ({ email }) => void messages.push(email) },
      testEngine: { generateQuestions: async ({ topic }) => { generated.push(topic); return []; } },
    });
    await store.dispatch({ type: "create-quick-test", topic: "Vectors", questionCount: 3, difficulty: "easy", durationMinutes: 10, negativeMarking: false, releasePolicy: "learning-mode" });
    await store.dispatch({ type: "invite-student", email: "new@example.com", classId: "class-aurora-physics" });
    expect(generated).toEqual(["Vectors"]);
    expect(messages).toEqual(["new@example.com"]);
  });
});
