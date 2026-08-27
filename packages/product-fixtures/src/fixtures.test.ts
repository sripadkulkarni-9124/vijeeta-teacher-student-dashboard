import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DEMO_ASSIGNMENT,
  DEMO_ATTEMPT,
  DEMO_ORGANISATION,
  DEMO_RESULT,
  DEMO_TEST,
  selectSurfaceScenario,
} from "./index";
import {
  STUDENT_DELIVERY_FIXTURE,
  type StudentDeliveryQuestion,
} from "./student-delivery";

describe("product journey fixtures", () => {
  it("links one assignment across teacher and student surfaces", () => {
    expect(DEMO_ASSIGNMENT.testId).toBe(DEMO_TEST.id);
    expect(DEMO_ASSIGNMENT.organisationId).toBe(DEMO_ORGANISATION.id);
    expect(DEMO_RESULT.attemptId).toBe(DEMO_ATTEMPT.id);
  });

  it("does not place embargoed answers in an unreleased attempt", () => {
    expect(JSON.stringify(DEMO_ATTEMPT)).not.toMatch(/correctAnswer|explanation/);
  });

  it("keeps the answer-free student delivery projection exactly aligned", () => {
    expect(STUDENT_DELIVERY_FIXTURE.organisation).toEqual(DEMO_ORGANISATION);
    expect(STUDENT_DELIVERY_FIXTURE.student.id).toBe(DEMO_ATTEMPT.studentId);
    expect(STUDENT_DELIVERY_FIXTURE.test.id).toBe(DEMO_TEST.id);
    expect(STUDENT_DELIVERY_FIXTURE.assignment.id).toBe(DEMO_ASSIGNMENT.id);
    expect(STUDENT_DELIVERY_FIXTURE.attempt).toMatchObject({
      assignmentId: DEMO_ATTEMPT.assignmentId,
      id: DEMO_ATTEMPT.id,
      organisationId: DEMO_ATTEMPT.organisationId,
      studentId: DEMO_ATTEMPT.studentId,
    });
    expect(STUDENT_DELIVERY_FIXTURE.test.questions).toEqual(
      DEMO_TEST.questions.map(({ choices, id, prompt }) => ({
        choices: choices.map(({ id: choiceId, label }) => ({
          id: choiceId,
          label,
        })),
        id,
        prompt,
      })),
    );
    expect(JSON.stringify(STUDENT_DELIVERY_FIXTURE)).not.toMatch(
      /correctAnswerId|explanation/,
    );
    expectTypeOf<
      Extract<keyof StudentDeliveryQuestion, "correctAnswerId" | "explanation">
    >().toEqualTypeOf<never>();
  });

  it("falls back to the ready scenario for an unknown query value", () => {
    expect(selectSurfaceScenario("unexpected-value")).toBe("ready");
  });

  it.each(["toString", "constructor"])(
    "falls back to ready for inherited query key %s",
    (queryValue) => {
      expect(selectSurfaceScenario(queryValue)).toBe("ready");
    },
  );
});
