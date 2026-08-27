import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Field, Select } from "./field";

describe("form field primitives", () => {
  it("associates the label, error, invalid state, and requirement with a native input", () => {
    render(
      <Field label="Test name" error="Enter a test name" required>
        {(props) => <input {...props} />}
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: /test name/i });
    expect(input).toHaveAccessibleDescription("Enter a test name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toBeRequired();
  });

  it("renders a labelled native select with support text", () => {
    render(
      <Select
        label="Subject"
        support="Choose the syllabus subject"
        options={[
          { value: "physics", label: "Physics" },
          { value: "chemistry", label: "Chemistry" },
        ]}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Subject" }),
    ).toHaveAccessibleDescription("Choose the syllabus subject");
  });
});
