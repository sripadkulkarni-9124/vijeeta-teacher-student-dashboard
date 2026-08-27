import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Alert, Badge, Toast } from "./feedback";

describe("feedback primitives", () => {
  it("communicates status with visible text instead of colour alone", () => {
    render(<Badge tone="success">Published</Badge>);

    const badge = screen.getByText("Published");
    expect(badge).toBeVisible();
    expect(badge).toHaveAttribute("data-tone", "success");
  });

  it("uses assertive and polite live-region roles appropriately", () => {
    render(
      <>
        <Alert tone="danger" title="Could not save">
          Check the form and try again.
        </Alert>
        <Toast>Draft saved</Toast>
      </>,
    );

    expect(
      screen.getByRole("alert", { name: "Could not save" }),
    ).toHaveTextContent("Check the form and try again.");
    expect(screen.getByRole("status")).toHaveTextContent("Draft saved");
  });
});
