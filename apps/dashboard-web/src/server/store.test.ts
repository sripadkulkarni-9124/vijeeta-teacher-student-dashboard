import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardStore } from "./store";

async function tempStatePath() {
  return join(await mkdtemp(join(tmpdir(), "vijeeta-dashboard-")), "state.json");
}

describe("DashboardStore", () => {
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
    const started = await store.dispatch({ type: "start-attempt", assignmentId: "assignment-physics-foundations-01" });
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
