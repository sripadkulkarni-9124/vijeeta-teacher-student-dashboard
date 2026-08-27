import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductionDashboard,
  type ProductionApiLike,
  type ProductionProfile,
} from "./production-dashboard";

const profile: ProductionProfile = {
  activeRole: null,
  allowedRoles: ["student", "teacher"],
  onboardingComplete: false,
  user: { uid: "uid-1", email: "aarav@example.test", displayName: "Aarav Kulkarni" },
};

const api = (): ProductionApiLike => ({
  auth: {
    currentUser: profile.user,
    getIdToken: vi.fn(async () => "token"),
    signInWithEmailPassword: vi.fn(async () => profile.user),
    signInWithGoogle: vi.fn(async () => profile.user),
    signOut: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  },
  getProfile: vi.fn(async () => profile),
  onboard: vi.fn(async (role) => ({ ...profile, activeRole: role, onboardingComplete: true })),
  readStudent: vi.fn(async () => ({
    discovery: { classes: [{ id: "class-1", name: "Class 11 Physics" }] },
    tests: { assigned: [{ id: "test-1", title: "Motion checkpoint", status: "assigned", capabilityToken: "must-not-render" }] },
    analysis: { averageScore: 78, focusArea: "Acceleration graphs" },
  })),
  readTeacher: vi.fn(async () => ({ config: { organisation: "Aurora Academy" }, jobs: [] })),
});

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

describe("ProductionDashboard", () => {
  it("offers first-login role onboarding and never persists the choice in browser storage", async () => {
    const productionApi = api();
    render(<ProductionDashboard api={productionApi} />);

    expect(await screen.findByRole("heading", { name: /choose your workspace/i })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /continue as student/i }));

    await waitFor(() => expect(productionApi.onboard).toHaveBeenCalledWith("student"));
    expect(window.localStorage.getItem("vijeeta-dashboard-role")).toBeNull();
    expect(window.sessionStorage.getItem("vijeeta-dashboard-role")).toBeNull();
    expect(await screen.findByRole("heading", { name: /student dashboard/i })).toBeVisible();
    expect(window.location.pathname).toBe("/dashboard/student");
  });

  it("routes an existing active role to read-only student data and disables writes", async () => {
    const productionApi = api();
    productionApi.getProfile = vi.fn(async (): Promise<ProductionProfile> => ({
      ...profile,
      activeRole: "student",
      allowedRoles: ["student"],
      onboardingComplete: true,
    }));
    render(<ProductionDashboard api={productionApi} />);

    expect(await screen.findByRole("heading", { name: /student dashboard/i })).toBeVisible();
    expect(await screen.findByText("Class 11 Physics")).toBeVisible();
    expect(screen.getByText("Motion checkpoint")).toBeVisible();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(screen.getByText(/read-only production view/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /start test/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit attempt/i })).toBeDisabled();
    expect(productionApi.readStudent).toHaveBeenCalledTimes(1);
  });

  it("refuses a URL role that the server profile does not allow", async () => {
    window.history.replaceState({}, "", "/dashboard/teacher");
    const productionApi = api();
    productionApi.getProfile = vi.fn(async (): Promise<ProductionProfile> => ({
      ...profile,
      activeRole: "student",
      allowedRoles: ["student"],
      onboardingComplete: true,
    }));
    render(<ProductionDashboard api={productionApi} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not authorized/i);
    expect(productionApi.readTeacher).not.toHaveBeenCalled();
  });

  it("shows a pending Teacher state without granting either production workspace", async () => {
    const productionApi = api();
    productionApi.getProfile = vi.fn(async (): Promise<ProductionProfile> => ({
      ...profile,
      activeRole: null,
      allowedRoles: [],
      onboardingComplete: true,
    }));
    render(<ProductionDashboard api={productionApi} />);

    expect(await screen.findByRole("heading", { name: /choose your workspace/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /continue as student/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue as teacher/i })).not.toBeInTheDocument();
    expect(productionApi.readStudent).not.toHaveBeenCalled();
    expect(productionApi.readTeacher).not.toHaveBeenCalled();
  });

  it("shows unauthorized-domain and logout feedback", async () => {
    const productionApi = api();
    productionApi.auth.currentUser = null;
    productionApi.auth.signInWithGoogle = vi.fn(async () => {
      throw Object.assign(new Error("popup blocked"), { code: "auth/unauthorized-domain" });
    });
    render(<ProductionDashboard api={productionApi} />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authorized domain/i);
  });
});
