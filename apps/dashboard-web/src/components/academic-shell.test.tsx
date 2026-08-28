import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcademicShell } from "./academic-shell";

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

describe("AcademicShell", () => {
  it("renders semantic landmarks, active navigation, and only server-authorized items", () => {
    render(
      <AcademicShell
        profile={{ displayName: "Asha Admin", email: "asha@example.test", activeRole: "admin" }}
        navigation={[
          { label: "Overview", href: "/admin", icon: "⌂" },
          { label: "Audit", href: "/admin#audit", icon: "✓" },
        ]}
        currentHref="/admin"
        onSignOut={vi.fn()}
      >
        <h1>Administration</h1>
      </AcademicShell>,
    );

    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("banner")).toBeVisible();
    const primary = screen.getByRole("navigation", { name: /primary/i });
    expect(within(primary).getByRole("link", { name: /overview/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/teacher workspace|student workspace/i)).not.toBeInTheDocument();
  });

  it("exposes desktop and mobile navigation structures without JavaScript role inference", () => {
    const { container } = render(
      <AcademicShell
        profile={{ displayName: "Asha Admin", email: null, activeRole: "admin" }}
        navigation={[{ label: "Administration", href: "/admin", icon: "A" }]}
        currentHref="/admin"
      >
        <h1>Administration</h1>
      </AcademicShell>,
    );

    expect(container.querySelector(".academic-shell__sidebar")).toBeInTheDocument();
    expect(container.querySelector(".academic-shell__mobile-nav")).toBeInTheDocument();
    expect(container.querySelector(".academic-shell__content-grid")).toBeInTheDocument();
    expect(screen.getAllByText("Admin workspace")).toHaveLength(2);
  });

  it("keeps Overview inactive when a hash-selected Admin section is current", async () => {
    window.history.replaceState({}, "", "/admin#admin-classes");
    render(
      <AcademicShell
        profile={{ displayName: "Asha Admin", email: null, activeRole: "admin" }}
        navigation={[
          { label: "Overview", href: "/admin", icon: "O" },
          { label: "Classes", href: "/admin#admin-classes", icon: "C" },
          { label: "Audit", href: "/admin#admin-audit", icon: "A" },
        ]}
        currentHref="/admin"
      >
        <h1>Administration</h1>
      </AcademicShell>,
    );

    const primary = screen.getByRole("navigation", { name: /primary/i });
    const overview = within(primary).getByRole("link", { name: /overview/i });
    const classes = within(primary).getByRole("link", { name: /classes/i });
    const audit = within(primary).getByRole("link", { name: /audit/i });
    await waitFor(() => expect(classes).toHaveAttribute("aria-current", "page"));
    expect(overview).not.toHaveAttribute("aria-current");

    fireEvent.click(audit);
    expect(audit).toHaveAttribute("aria-current", "page");
    expect(overview).not.toHaveAttribute("aria-current");
    window.history.pushState({}, "", "/admin");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(overview).toHaveAttribute("aria-current", "page"));
  });
});
