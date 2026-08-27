import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Button, IconButton, Link } from "./button";

describe("action primitives", () => {
  it("announces a loading button by its current action and disables it", () => {
    render(
      <Button loading loadingLabel="Creating test">
        Create test
      </Button>,
    );

    expect(
      screen.getByRole("button", { name: "Creating test" }),
    ).toBeDisabled();
  });

  it("requires an explicit icon-button name and preserves native link behavior", () => {
    render(
      <>
        <IconButton label="Close panel">×</IconButton>
        <Link href="/tests">View tests</Link>
      </>,
    );

    expect(screen.getByRole("button", { name: "Close panel" })).toHaveAttribute(
      "type",
      "button",
    );
    expect(screen.getByRole("link", { name: "View tests" })).toHaveAttribute(
      "href",
      "/tests",
    );
  });
});
