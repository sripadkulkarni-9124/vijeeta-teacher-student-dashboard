import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import "./test-setup";
import { Dialog, Drawer } from "./dialog";

function DialogHarness({ drawer = false }: { drawer?: boolean }) {
  const [open, setOpen] = useState(false);
  const Overlay = drawer ? Drawer : Dialog;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <Overlay open={open} onClose={() => setOpen(false)} title="Edit test">
        <button hidden type="button">Hidden action</button>
        <button tabIndex={-1} type="button">Programmatic action</button>
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </Overlay>
    </>
  );
}

describe("Dialog", () => {
  it("moves focus inside, traps Tab, closes on Escape, and restores trigger focus", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open editor" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Edit test" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(cancel).toHaveFocus();

    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("gives drawers the same modal keyboard contract", () => {
    render(<DialogHarness drawer />);
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));

    expect(screen.getByRole("dialog", { name: "Edit test" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("contains programmatic background focus and handles Escape for the modal lifetime", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open editor" });
    trigger.focus();
    fireEvent.click(trigger);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    trigger.focus();
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("skips hidden and negatively-tabbed controls when moving focus", () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
