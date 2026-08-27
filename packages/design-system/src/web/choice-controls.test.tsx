import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Checkbox, Radio, Switch } from "./choice-controls";

describe("choice controls", () => {
  it("uses named native checkbox and radio inputs", () => {
    render(
      <>
        <Checkbox label="Include solutions" />
        <Radio label="JEE Main" name="exam" value="main" />
      </>,
    );

    expect(
      screen.getByRole("checkbox", { name: "Include solutions" }),
    ).toHaveAttribute("type", "checkbox");
    expect(screen.getByRole("radio", { name: "JEE Main" })).toHaveAttribute(
      "name",
      "exam",
    );
  });

  it("uses a named checkbox with switch semantics and remains keyboard-toggleable", () => {
    render(<Switch label="Publish results" />);
    const control = screen.getByRole("switch", { name: "Publish results" });

    fireEvent.click(control);
    expect(control).toBeChecked();
  });
});
