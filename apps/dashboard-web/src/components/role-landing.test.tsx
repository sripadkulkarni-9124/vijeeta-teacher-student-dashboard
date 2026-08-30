import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoleLanding } from "./role-landing";

describe("RoleLanding", () => {
  it("asks the single sign-up question and keeps the role selection contract", () => {
    const onSelectRole = vi.fn();
    render(<RoleLanding onSelectRole={onSelectRole} />);

    expect(
      screen.getByRole("heading", { name: "Are you a teacher or a student?" }),
    ).toBeVisible();
    expect(screen.getByText("ViJEEta")).toBeVisible();
    expect(screen.getByText("by Vedantu")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue as teacher" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue as student" }));

    expect(onSelectRole).toHaveBeenNthCalledWith(1, "teacher");
    expect(onSelectRole).toHaveBeenNthCalledWith(2, "student");
  });
});
