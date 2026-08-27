import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Stepper } from "./stepper";

describe("Stepper", () => {
  it("marks the current step and exposes visible progress words", () => {
    render(
      <Stepper
        label="Create test progress"
        currentStepId="questions"
        steps={[
          { id: "details", label: "Details" },
          { id: "questions", label: "Questions" },
          { id: "review", label: "Review" },
        ]}
      />,
    );

    expect(screen.getByText("Questions").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("Complete")).toBeVisible();
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
  });
});
