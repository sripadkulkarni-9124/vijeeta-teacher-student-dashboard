import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Tabs } from "./tabs";

const items = [
  { id: "overview", label: "Overview", panel: <p>Overview panel</p> },
  { id: "questions", label: "Questions", panel: <p>Questions panel</p> },
  { id: "settings", label: "Settings", panel: <p>Settings panel</p> },
];

describe("Tabs", () => {
  it("uses one tab stop and activates the next tab with ArrowRight", () => {
    render(<Tabs label="Test sections" items={items} />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const questions = screen.getByRole("tab", { name: "Questions" });

    expect(overview).toHaveAttribute("tabindex", "0");
    expect(questions).toHaveAttribute("tabindex", "-1");
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });

    expect(questions).toHaveFocus();
    expect(questions).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Questions" }),
    ).toHaveTextContent("Questions panel");
  });

  it("wraps arrow-key navigation from the first to the last tab", () => {
    render(<Tabs label="Test sections" items={items} />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowLeft" });

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
  });

  it("selects the first enabled tab when the active tab is removed", () => {
    const { rerender } = render(
      <Tabs label="Test sections" items={items} defaultTabId="questions" />,
    );

    rerender(
      <Tabs
        label="Test sections"
        items={items.filter((item) => item.id !== "questions")}
        defaultTabId="questions"
      />,
    );

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Overview" }),
    ).toHaveTextContent("Overview panel");
  });

  it("selects the first enabled tab when the active tab becomes disabled", () => {
    const { rerender } = render(
      <Tabs label="Test sections" items={items} defaultTabId="questions" />,
    );
    const disabledItems = items.map((item) =>
      item.id === "questions" ? { ...item, disabled: true } : item,
    );

    rerender(<Tabs label="Test sections" items={disabledItems} />);

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Questions" })).toBeDisabled();
    expect(
      screen.getByRole("tabpanel", { name: "Overview" }),
    ).toHaveTextContent("Overview panel");
  });
});
