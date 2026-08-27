import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardPrototype } from "./dashboard-prototype";

describe("DashboardPrototype", () => {
  it("loads the role snapshot from the local API and switches back", async () => {
    const api = {
      snapshot: vi.fn(async () => ({
        role: "teacher" as const,
        session: {
          role: "teacher" as const,
          userId: "teacher-1",
          displayName: "Meera Shah",
          organisationId: "org-1",
        },
        organisation: { id: "org-1", name: "Aurora Academy" },
        classes: [
          {
            id: "class-1",
            name: "Class 11 Physics",
            subject: "Physics",
            roster: [
              {
                id: "student-1",
                displayName: "Aarav Kulkarni",
                email: "aarav@example.test",
                status: "active" as const,
              },
            ],
          },
        ],
        invites: [],
        quickTests: [],
        assignments: [],
        insights: {
          aggregate: { attempted: 0, pending: 1, averageScore: 0 },
          individual: [
            {
              studentId: "student-1",
              displayName: "Aarav Kulkarni",
              score: null,
              status: "pending" as const,
            },
          ],
        },
      })),
      mutate: vi.fn(async () => ({})),
    };
    render(<DashboardPrototype api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue as teacher" }));
    expect(
      await screen.findByRole("heading", { name: "Teacher dashboard" }),
    ).toBeVisible();
    expect(api.snapshot).toHaveBeenCalledWith("teacher");
    expect(screen.getByText("Local API connected")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Switch role" }));
    expect(
      screen.getByRole("heading", { name: "Choose your demo workspace" }),
    ).toBeVisible();
  });
});
