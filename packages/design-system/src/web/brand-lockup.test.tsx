import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { BrandLockup } from "./brand-lockup";

describe("brand lockup", () => {
  it("renders the wordmark and Vedantu attribution as real text", () => {
    render(<BrandLockup />);

    expect(screen.getByText("ViJEEta")).toBeVisible();
    expect(screen.getByText("by Vedantu")).toBeVisible();
  });

  it("draws the mark inline and hides it from assistive technology", () => {
    const { container } = render(<BrandLockup size="compact" data-testid="lockup" />);
    const mark = container.querySelector("svg");

    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("focusable", "false");
    expect(mark?.querySelector("image")).toBeNull();
    expect(screen.getByTestId("lockup")).toHaveAttribute("data-size", "compact");
  });

  it("keeps every colour on a brand token so themes stay in control", () => {
    const { container } = render(<BrandLockup />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(container.innerHTML).toContain("var(--vjt-brand-mark)");
    expect(container.innerHTML).toContain("var(--vjt-brand-highlight)");
  });
});
