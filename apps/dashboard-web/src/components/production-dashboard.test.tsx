import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConnectedDashboardNavigation,
  ProductionDashboard,
  consumeInviteTokenFragment,
  resolveDashboardRoute,
  resolveProtectedRoute,
  type ConnectedNavigationApi,
  type ProductionApiLike,
  type ProductionProfile,
} from "./production-dashboard";
import type { DashboardProfileV2 } from "@vijeeta/api-contracts";

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
  const serverProfile = (overrides: Partial<DashboardProfileV2> = {}): DashboardProfileV2 => ({
    internalProfileId: "profile-1", firebaseUid: "uid-1", verifiedEmail: "aarav@example.test", displayName: "Aarav",
    roles: { student: "active" }, activeRole: "student", onboardingCompleted: true, schemaVersion: 2,
    createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z", ...overrides,
  });

  it("derives every canonical route only from authenticated server profile state", () => {
    expect(resolveDashboardRoute({ authenticated: false, profile: null })).toEqual({ state: "signed_out", canonicalPath: "/" });
    expect(resolveDashboardRoute({ authenticated: true, profile: null })).toEqual({ state: "onboarding", canonicalPath: "/onboarding" });
    expect(resolveDashboardRoute({ authenticated: true, profile: serverProfile({ roles: { teacher: "pending" }, activeRole: null }) })).toEqual({ state: "pending_teacher", canonicalPath: "/pending-teacher" });
    expect(resolveDashboardRoute({ authenticated: true, profile: serverProfile({ roles: { teacher: "suspended" }, activeRole: null }) })).toEqual({ state: "suspended", canonicalPath: "/suspended" });
    expect(resolveDashboardRoute({ authenticated: true, profile: serverProfile() })).toEqual({ state: "student", canonicalPath: "/student" });
    expect(resolveDashboardRoute({ authenticated: true, profile: serverProfile({ roles: { teacher: "active" }, activeRole: "teacher" }) })).toEqual({ state: "teacher", canonicalPath: "/teacher" });
    expect(resolveDashboardRoute({ authenticated: true, profile: serverProfile({ roles: { admin: "active" }, activeRole: "admin" }) })).toEqual({ state: "admin", canonicalPath: "/admin" });
  });

  it("redirects forged role URLs and hides inactive multi-role workspaces", () => {
    const student = serverProfile({ roles: { student: "active", teacher: "pending" }, activeRole: "student" });
    expect(resolveProtectedRoute("teacher", true, student)).toEqual({ render: false, redirect: "/student" });
    expect(resolveProtectedRoute("student", true, student)).toEqual({ render: true, redirect: null });
    expect(resolveProtectedRoute("invite", false, null)).toEqual({ render: false, redirect: "/" });
    expect(resolveProtectedRoute("invite", true, null)).toEqual({ render: true, redirect: null });
  });

  it("clears a fragment invitation token into memory and removes it from browser history", () => {
    window.history.replaceState({}, "", "/invite#token=invite-1.secret-value");
    expect(consumeInviteTokenFragment()).toBe("invite-1.secret-value");
    expect(window.location.pathname).toBe("/invite");
    expect(window.location.hash).toBe("");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("never renders Teacher content for a Student opening a forged Teacher route", async () => {
    window.history.replaceState({}, "", "/teacher");
    const connected: ConnectedNavigationApi = {
      auth: api().auth,
      getProfile: vi.fn(async () => serverProfile()),
      onboard: vi.fn(),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="teacher" />);

    expect(screen.getByRole("status")).toHaveTextContent(/checking your dashboard access/i);
    expect(screen.queryByText(/teacher workspace/i)).not.toBeInTheDocument();

    await waitFor(() => expect(window.location.pathname).toBe("/student"));
    // The Student is moved to their own workspace rather than left on the
    // redirect placeholder, and Teacher content is never rendered on the way.
    expect(await screen.findByRole("heading", { name: /student workspace/i })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /teacher workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/redirecting to your authorized workspace/i)).not.toBeInTheDocument();
  });

  it.each([
    ["admin" as const, serverProfile({ roles: { teacher: "active" }, activeRole: "teacher" }), "/teacher"],
    ["teacher" as const, serverProfile({ roles: { teacher: "pending" }, activeRole: null }), "/pending-teacher"],
    ["teacher" as const, serverProfile({ roles: { teacher: "suspended" }, activeRole: null }), "/suspended"],
  ])("never renders protected content while redirecting a wrong %s route", async (requestedRoute, persisted, canonicalPath) => {
    window.history.replaceState({}, "", `/${requestedRoute}`);
    const connected: ConnectedNavigationApi = {
      auth: api().auth, getProfile: vi.fn(async () => persisted), onboard: vi.fn(), setActiveRole: vi.fn(), inspectInvitation: vi.fn(), acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute={requestedRoute} />);

    expect(await screen.findByText(/redirecting to your authorized workspace/i)).toBeVisible();
    expect(screen.queryByText(/student workspace|teacher workspace|admin workspace/i)).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(canonicalPath));
  });

  it("offers only Student and Teacher during first-use onboarding and keeps Teacher pending", async () => {
    const connected: ConnectedNavigationApi = {
      auth: api().auth,
      getProfile: vi.fn(async () => { throw Object.assign(new Error("onboarding"), { code: "profile_onboarding_required", status: 404 }); }),
      onboard: vi.fn(async () => serverProfile({ roles: { teacher: "pending" }, activeRole: null })),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="onboarding" />);

    expect(await screen.findByRole("button", { name: /continue as student/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /request teacher access/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /admin/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /request teacher access/i }));
    expect(await screen.findByRole("heading", { name: /teacher approval pending/i })).toBeVisible();
    expect(window.location.pathname).toBe("/pending-teacher");
  });

  it("shows only active server roles and persists a role switch before replacing navigation", async () => {
    const teacher = serverProfile({ roles: { student: "active", teacher: "active", admin: "suspended" }, activeRole: "teacher" });
    const student = serverProfile({ roles: teacher.roles, activeRole: "student" });
    const connected: ConnectedNavigationApi = {
      auth: api().auth,
      getProfile: vi.fn(async () => teacher),
      onboard: vi.fn(),
      setActiveRole: vi.fn(async () => student),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="teacher" />);

    expect(await screen.findByRole("heading", { name: /teacher workspace/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /switch to admin/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /switch to student/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/checking your dashboard access/i);
    expect(await screen.findByRole("heading", { name: /student workspace/i })).toBeVisible();
    expect(connected.setActiveRole).toHaveBeenCalledWith("student");
    expect(window.location.pathname).toBe("/student");
  });

  it.each([
    ["student" as const, "teacher" as const],
    ["teacher" as const, "student" as const],
  ])("recovers an active %s role without exposing the suspended %s role", async (activeRole, suspendedRole) => {
    const waiting = serverProfile({ roles: { [activeRole]: "active", [suspendedRole]: "suspended" }, activeRole: null });
    const activated = serverProfile({ roles: waiting.roles, activeRole });
    const connected: ConnectedNavigationApi = {
      auth: api().auth, getProfile: vi.fn(async () => waiting), onboard: vi.fn(), setActiveRole: vi.fn(async () => activated), inspectInvitation: vi.fn(), acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="suspended" />);

    expect(await screen.findByRole("heading", { name: /workspace suspended/i })).toBeVisible();
    expect(screen.getByRole("button", { name: new RegExp(`${activeRole} workspace`, "i") })).toBeVisible();
    expect(screen.queryByRole("button", { name: new RegExp(`${suspendedRole} workspace`, "i") })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${activeRole} workspace`, "i") }));
    expect(screen.getByRole("status")).toHaveTextContent(/checking your dashboard access/i);
    expect(screen.queryByText(/student workspace|teacher workspace|admin workspace/i)).not.toBeInTheDocument();
    await waitFor(() => expect(connected.setActiveRole).toHaveBeenCalledWith(activeRole));
    await waitFor(() => expect(window.location.pathname).toBe(`/${activeRole}`));
    expect(await screen.findByRole("heading", { name: new RegExp(`${activeRole} workspace`, "i") })).toBeVisible();
  });

  it("signs up with Google and onboards with the role chosen on the form", async () => {
    window.history.replaceState({}, "", "/");
    const signedIn = { uid: "new-uid", email: "learner@example.test", displayName: null };
    const teacher = serverProfile({ roles: { teacher: "pending" }, activeRole: null });
    const auth = api().auth;
    const connected: ConnectedNavigationApi = {
      auth: {
        ...auth,
        currentUser: null,
        subscribe: () => () => undefined,
        signInWithGoogle: vi.fn(async () => signedIn),
        isEmailVerified: vi.fn(async () => true),
      },
      getProfile: vi.fn(async () => { throw Object.assign(new Error("no profile"), { code: "profile_onboarding_required" }); }),
      onboard: vi.fn(async () => teacher),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="root" />);

    fireEvent.click(await screen.findByRole("tab", { name: /sign up/i }));
    fireEvent.click(screen.getByRole("radio", { name: /teacher/i }));
    fireEvent.click(screen.getByRole("button", { name: /sign up with google/i }));

    await waitFor(() => expect(connected.auth.signInWithGoogle).toHaveBeenCalled());
    // The role chosen before sign-in must survive the round trip.
    await waitFor(() => expect(connected.onboard).toHaveBeenCalledWith("teacher"));
  });

  it("defaults sign-up to Student and never offers Admin", async () => {
    window.history.replaceState({}, "", "/");
    const auth = api().auth;
    const connected: ConnectedNavigationApi = {
      auth: { ...auth, currentUser: null, subscribe: () => () => undefined },
      getProfile: vi.fn(), onboard: vi.fn(), setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(), acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="root" />);

    fireEvent.click(await screen.findByRole("tab", { name: /sign up/i }));
    expect(screen.getByRole("radio", { name: /student/i })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("lands in the workspace after a client-side sign-in instead of stalling on the redirect", async () => {
    window.history.replaceState({}, "", "/");
    const teacher = serverProfile({ roles: { teacher: "active" }, activeRole: "teacher" });
    const signedIn = { uid: "uid-1", email: "teacher@example.test", displayName: "Teacher" };
    const auth = api().auth;
    const connected: ConnectedNavigationApi = {
      auth: { ...auth, currentUser: null, subscribe: () => () => undefined, signInWithGoogle: vi.fn(async () => signedIn) },
      getProfile: vi.fn(async () => teacher),
      onboard: vi.fn(),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="root" />);

    fireEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/teacher"));
    // The URL moving is not enough: the view must follow it.
    expect(await screen.findByRole("heading", { name: /teacher workspace/i })).toBeVisible();
    expect(screen.queryByText(/redirecting to your authorized workspace/i)).not.toBeInTheDocument();
  });

  it("explains the verification requirement instead of failing Teacher onboarding", async () => {
    window.history.replaceState({}, "", "/onboarding");
    const auth = api().auth;
    const connected: ConnectedNavigationApi = {
      auth: {
        ...auth,
        currentUser: { uid: "uid-1", email: "learner@example.test", displayName: null },
        subscribe: (next) => { next({ uid: "uid-1", email: "learner@example.test", displayName: null }); return () => undefined; },
        isEmailVerified: vi.fn(async () => false),
        resendEmailVerification: vi.fn(async () => undefined),
      },
      getProfile: vi.fn(async () => { throw Object.assign(new Error("no profile"), { code: "profile_onboarding_required" }); }),
      onboard: vi.fn(),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="onboarding" />);

    fireEvent.click(await screen.findByRole("button", { name: /request teacher access/i }));

    // The server rejects an unverified principal for Teacher, so the UI must not
    // send the request and then surface a bare "not permitted".
    await waitFor(() => expect(connected.auth.resendEmailVerification).toHaveBeenCalled());
    expect(connected.onboard).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: /verify your email/i })).toBeVisible();
  });

  it("onboards a Student without requiring a verified email", async () => {
    window.history.replaceState({}, "", "/onboarding");
    const student = serverProfile({ roles: { student: "active" }, activeRole: "student" });
    const auth = api().auth;
    const connected: ConnectedNavigationApi = {
      auth: {
        ...auth,
        currentUser: { uid: "uid-1", email: "learner@example.test", displayName: null },
        subscribe: (next) => { next({ uid: "uid-1", email: "learner@example.test", displayName: null }); return () => undefined; },
        isEmailVerified: vi.fn(async () => false),
      },
      getProfile: vi.fn(async () => { throw Object.assign(new Error("no profile"), { code: "profile_onboarding_required" }); }),
      onboard: vi.fn(async () => student),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="onboarding" />);

    fireEvent.click(await screen.findByRole("button", { name: /continue as student/i }));

    await waitFor(() => expect(connected.onboard).toHaveBeenCalledWith("student"));
    await waitFor(() => expect(window.location.pathname).toBe("/student"));
  });

  it("inspects a captured invitation and joins the class", async () => {
    window.history.replaceState({}, "", "/invite#token=invite-1.secret");
    const student = serverProfile({ roles: { student: "active" }, activeRole: "student" });
    const connected: ConnectedNavigationApi = {
      auth: api().auth,
      getProfile: vi.fn(async () => student),
      onboard: vi.fn(),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(async () => ({
        inviteId: "invite-1", classroomId: "class-1", classroomName: "Grade 12 Physics",
        teacherDisplayName: "Dr. Sharma", targetEmailMatches: true, studentOnboardingRequired: false,
        expiresAt: "2026-09-04T00:00:00.000Z", status: "pending" as const,
      })),
      acceptInvitation: vi.fn(async () => ({})),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="invite" />);

    await waitFor(() => expect(connected.inspectInvitation).toHaveBeenCalledWith("invite-1.secret"));
    expect(await screen.findByText(/Dr\. Sharma invited you to join Grade 12 Physics/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /join class/i }));
    await waitFor(() => expect(connected.acceptInvitation).toHaveBeenCalledWith("invite-1.secret"));
    await waitFor(() => expect(window.location.pathname).toBe("/student"));
  });

  it("refuses to offer a join when the invitation was sent to another address", async () => {
    window.history.replaceState({}, "", "/invite#token=invite-1.secret");
    const student = serverProfile({ roles: { student: "active" }, activeRole: "student" });
    const connected: ConnectedNavigationApi = {
      auth: api().auth,
      getProfile: vi.fn(async () => student),
      onboard: vi.fn(),
      setActiveRole: vi.fn(),
      inspectInvitation: vi.fn(async () => ({
        inviteId: "invite-1", classroomId: "class-1", classroomName: "Grade 12 Physics",
        teacherDisplayName: "Dr. Sharma", targetEmailMatches: false, studentOnboardingRequired: false,
        expiresAt: "2026-09-04T00:00:00.000Z", status: "pending" as const,
      })),
      acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="invite" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/different email address/i);
    expect(screen.queryByRole("button", { name: /join class/i })).not.toBeInTheDocument();
    expect(connected.acceptInvitation).not.toHaveBeenCalled();
  });

  it("clears protected content immediately when Firebase reports a different signed-in profile", async () => {
    let listener: ((user: typeof profile.user | null) => void) | undefined;
    let resolveSecond!: (value: DashboardProfileV2) => void;
    const second = new Promise<DashboardProfileV2>((resolve) => { resolveSecond = resolve; });
    const teacher = serverProfile({ roles: { teacher: "active" }, activeRole: "teacher" });
    const connected: ConnectedNavigationApi = {
      auth: { ...api().auth, subscribe: (next) => { listener = next; return () => undefined; } },
      getProfile: vi.fn().mockResolvedValueOnce(teacher).mockReturnValueOnce(second),
      onboard: vi.fn(), setActiveRole: vi.fn(), inspectInvitation: vi.fn(), acceptInvitation: vi.fn(),
    };
    render(<ConnectedDashboardNavigation api={connected} requestedRoute="teacher" />);
    expect(await screen.findByRole("heading", { name: /teacher workspace/i })).toBeVisible();

    listener?.({ uid: "uid-2", email: "student@example.test", displayName: "Student" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/checking your dashboard access/i));
    expect(screen.queryByRole("heading", { name: /teacher workspace/i })).not.toBeInTheDocument();
    resolveSecond(serverProfile({ firebaseUid: "uid-2", verifiedEmail: "student@example.test" }));
    expect(await screen.findByText(/redirecting to your authorized workspace/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: /student workspace/i })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/student"));
  });

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
