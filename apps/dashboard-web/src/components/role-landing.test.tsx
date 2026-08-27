import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoleLanding } from "./role-landing";

describe("RoleLanding", () => {
  it("offers one simulated sign-in entry for each dashboard role", () => {
    const onSelectRole = vi.fn();
    render(<RoleLanding onSelectRole={onSelectRole} />);

    expect(
      screen.getByRole("heading", { name: "Choose your demo workspace" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue as teacher" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue as student" }));

    expect(onSelectRole).toHaveBeenNthCalledWith(1, "teacher");
    expect(onSelectRole).toHaveBeenNthCalledWith(2, "student");
  });
});
