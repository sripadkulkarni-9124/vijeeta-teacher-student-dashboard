"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConnectedDashboardRole, DashboardProfileV2, InspectInvitationResponse } from "@vijeeta/api-contracts";

import { createConnectedApi, ConnectedApiError } from "@/client/connected-api";
import { createFirebaseAuth } from "@/client/firebase-auth";
import { AcademicShell } from "@/components/academic-shell";
import { AdminDashboard } from "@/features/admin/admin-dashboard";
import { ConnectedStudentDashboard } from "@/features/student/connected-student-dashboard";
import { ConnectedTeacherDashboard } from "@/features/teacher/connected-teacher-dashboard";
import {
  createProductionApi,
  ProductionApiError,
  type ProductionApi,
  type ProductionAuthSession,
  type ProductionProfile,
  type ProductionRole,
  type ProductionUser,
} from "@/client/production-api";

export type { ProductionAuthSession, ProductionProfile } from "@/client/production-api";

export type ProductionApiLike = ProductionApi;

export type DashboardRouteState = "signed_out" | "onboarding" | "pending_teacher" | "suspended" | "student" | "teacher" | "admin" | "error";
export type DashboardRequestedRoute = "root" | "onboarding" | "pending_teacher" | "suspended" | "student" | "teacher" | "admin" | "invite";

export interface ConnectedNavigationApi {
  auth: ProductionAuthSession;
  getProfile(): Promise<DashboardProfileV2>;
  onboard(role: "student" | "teacher"): Promise<DashboardProfileV2>;
  setActiveRole(role: ConnectedDashboardRole): Promise<DashboardProfileV2>;
  inspectInvitation(token: string): Promise<InspectInvitationResponse>;
  acceptInvitation(token: string): Promise<unknown>;
}

export function resolveDashboardRoute(input: {
  authenticated: boolean;
  profile: DashboardProfileV2 | null;
  error?: boolean;
}): { state: DashboardRouteState; canonicalPath: string } {
  if (input.error) return { state: "error", canonicalPath: "/" };
  if (!input.authenticated) return { state: "signed_out", canonicalPath: "/" };
  const profile = input.profile;
  if (profile === null || !profile.onboardingCompleted) return { state: "onboarding", canonicalPath: "/onboarding" };
  if (profile.activeRole !== null && profile.roles[profile.activeRole] === "active") {
    return { state: profile.activeRole, canonicalPath: `/${profile.activeRole}` };
  }
  if (Object.values(profile.roles).includes("suspended")) return { state: "suspended", canonicalPath: "/suspended" };
  if (profile.roles.teacher === "pending") return { state: "pending_teacher", canonicalPath: "/pending-teacher" };
  return { state: "error", canonicalPath: "/" };
}

export function resolveProtectedRoute(
  requested: DashboardRequestedRoute,
  authenticated: boolean,
  profile: DashboardProfileV2 | null,
): { render: boolean; redirect: string | null } {
  const resolved = resolveDashboardRoute({ authenticated, profile });
  if (requested === "invite") return authenticated ? { render: true, redirect: null } : { render: false, redirect: "/" };
  if (requested === "root") return resolved.state === "signed_out"
    ? { render: true, redirect: null }
    : { render: false, redirect: resolved.canonicalPath };
  return requested === resolved.state
    ? { render: true, redirect: null }
    : { render: false, redirect: resolved.canonicalPath };
}

function requestedRouteForState(state: DashboardRouteState): DashboardRequestedRoute {
  return state === "signed_out" || state === "error" ? "root" : state;
}

export function consumeInviteTokenFragment(): string | null {
  if (typeof window === "undefined") return null;
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = parameters.get("token");
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  return token && token.length <= 1024 ? token : null;
}

type ViewState = "loading" | "onboarding" | "ready" | "error";

function requestedRole(): ProductionRole | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/dashboard\/(student|teacher)\/?$/);
  return (match?.[1] as ProductionRole | undefined) ?? null;
}

const SAFE_DISPLAY_FIELDS = new Set([
  "displayName",
  "email",
  "focusArea",
  "kind",
  "label",
  "name",
  "organisation",
  "role",
  "state",
  "status",
  "subject",
  "teacher",
  "title",
  "topic",
]);

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      if (SAFE_DISPLAY_FIELDS.has(key) && typeof item === "string" && item.trim()) output.push(item);
      else if (Array.isArray(item) || (item && typeof item === "object")) collectStrings(item, output);
    });
  }
  return [...new Set(output)];
}

function hasData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function messageFor(error: unknown): string {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  if (code === "auth/unauthorized-domain") return "This sign-in domain is not in the Firebase authorized domain list.";
  if (error instanceof ProductionApiError && error.kind === "unauthorized") return "You are not authorized for this dashboard view.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function ProductionReadView({ role, api }: { role: ProductionRole; api: ProductionApiLike }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [data, setData] = useState<{ discovery?: unknown; tests?: unknown; analysis?: unknown; config?: unknown; jobs?: unknown }>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const next = role === "student" ? await api.readStudent() : await api.readTeacher();
      setData(next);
      setRefreshedAt(new Date());
      setState(Object.values(next).some(hasData) ? "ready" : "empty");
    } catch (caught) {
      setState("error");
      setError(messageFor(caught));
    }
  }, [api, role]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const sections = role === "student"
    ? [["Classes", data.discovery], ["Assigned and attempted tests", data.tests], ["Personal insights", data.analysis]] as const
    : [["Workspace configuration", data.config], ["Read-only jobs", data.jobs]] as const;

  return (
    <section className="production-read-view" aria-live="polite">
      <p>Read-only production view. Writes are disabled in this preview.</p>
      {refreshedAt ? <p>Refreshed data (not realtime): {refreshedAt.toLocaleTimeString()}</p> : null}
      <button type="button" onClick={() => void refresh()} disabled={state === "loading"}>
        {state === "loading" ? "Refreshing…" : "Refresh"}
      </button>
      {state === "loading" ? <p role="status">Loading production data…</p> : null}
      {state === "error" ? <p role="alert">{error}</p> : null}
      {state === "empty" ? <p role="status">No production data is available yet.</p> : null}
      {state === "ready" ? sections.map(([label, value]) => (
        <article key={label}>
          <h2>{label}</h2>
          <ul>
            {collectStrings(value).map((item) => <li key={`${label}-${item}`}>{item}</li>)}
          </ul>
        </article>
      )) : null}
      {role === "student" ? (
        <div className="student-production-actions">
          <button type="button" disabled>Start test</button>
          <button type="button" disabled>Submit attempt</button>
          <span>Preview only</span>
        </div>
      ) : (
        <div className="teacher-production-actions">
          <button type="button" disabled>Add class</button>
          <button type="button" disabled>Invite student</button>
          <button type="button" disabled>Create quick test</button>
          <button type="button" disabled>Assign/share test</button>
          <span>Preview only</span>
        </div>
      )}
    </section>
  );
}

function SignedOut({ api, onError }: { api: ProductionApiLike; onError: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try { await api.auth.signInWithGoogle(); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  return (
    <section className="production-sign-in">
      <h1>Sign in to Vijeeta</h1>
      <p>Use your organization’s Google account to continue.</p>
      <button type="button" onClick={() => void signIn()} disabled={busy}>
        {busy ? "Signing in…" : "Continue with Google"}
      </button>
    </section>
  );
}

function RoleChoice({ profile, onChoose }: { profile: ProductionProfile | null; onChoose: (role: ProductionRole) => Promise<void> }) {
  const roles = profile?.allowedRoles ?? ["student", "teacher"];
  return (
    <section className="production-onboarding">
      <h1>Choose your workspace</h1>
      <p>This choice is saved to your server profile.</p>
      {roles.includes("student") ? <button type="button" onClick={() => void onChoose("student")}>Continue as student</button> : null}
      {roles.includes("teacher") ? <button type="button" onClick={() => void onChoose("teacher")}>Continue as teacher</button> : null}
    </section>
  );
}

function defaultConnectedNavigationApi(): ConnectedNavigationApi {
  const auth = createFirebaseAuth();
  const connected = createConnectedApi({
    getIdToken: (forceRefresh) => auth.getIdToken(forceRefresh),
  });
  return {
    auth,
    getProfile: connected.getProfile,
    onboard: connected.onboard,
    setActiveRole: connected.setActiveRole,
    inspectInvitation: connected.inspectInvitation,
    acceptInvitation: connected.acceptInvitation,
  };
}

function replacePath(path: string): void {
  if (typeof window !== "undefined" && window.location.pathname !== path) window.history.replaceState({}, "", path);
}

function connectedMessage(error: unknown): string {
  if (error instanceof ConnectedApiError) {
    if (error.status === 401) return "Your sign-in expired. Sign in again to continue.";
    if (error.status === 403) return "Your account is not authorized for this workspace.";
    return error.message;
  }
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  if (code === "auth/unauthorized-domain") return "This sign-in domain is not in the Firebase authorized domain list.";
  return "The dashboard could not verify your access. Try again.";
}

/** Role gate. Every active workspace renders its Academic Precision view. */
export function ConnectedDashboardNavigation({
  api: suppliedApi,
  requestedRoute = "root",
}: {
  api?: ConnectedNavigationApi;
  requestedRoute?: DashboardRequestedRoute;
}) {
  const api = useMemo(() => suppliedApi ?? defaultConnectedNavigationApi(), [suppliedApi]);
  const [user, setUser] = useState(api.auth.currentUser);
  const [profile, setProfile] = useState<DashboardProfileV2 | null>(null);
  const [status, setStatus] = useState<"signed_out" | "loading" | "ready" | "error">(api.auth.currentUser ? "loading" : "signed_out");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<DashboardRequestedRoute>(requestedRoute);
  const [invitationLinkState, setInvitationLinkState] = useState<"unchecked" | "captured" | "missing">("unchecked");
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [signUpRole, setSignUpRole] = useState<"student" | "teacher">("student");
  const [awaitingVerification, setAwaitingVerification] = useState<{ email: string; role: "student" | "teacher" } | null>(null);
  const [invitation, setInvitation] = useState<InspectInvitationResponse | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const authorizationVersion = useRef(0);
  const invitationToken = useRef<string | null | undefined>(undefined);

  useEffect(() => setCurrentRoute(requestedRoute), [requestedRoute]);

  useEffect(() => {
    if (requestedRoute !== "invite" || invitationToken.current !== undefined) return;
    invitationToken.current = consumeInviteTokenFragment();
    setInvitationLinkState(invitationToken.current === null ? "missing" : "captured");
  }, [requestedRoute]);

  const loadProfile = useCallback(async (nextUser: ProductionUser) => {
    const requestVersion = ++authorizationVersion.current;
    setUser(nextUser);
    setProfile(null);
    setError(null);
    setStatus("loading");
    try {
      const nextProfile = await api.getProfile();
      if (requestVersion !== authorizationVersion.current) return;
      setProfile(nextProfile);
      setStatus("ready");
    } catch (caught) {
      if (requestVersion !== authorizationVersion.current) return;
      const code = caught && typeof caught === "object" ? (caught as { code?: string }).code : undefined;
      if (code === "profile_onboarding_required") {
        setProfile(null);
        setStatus("ready");
      } else if (code === "unauthenticated" || (caught instanceof ConnectedApiError && caught.status === 401)) {
        setUser(null);
        setProfile(null);
        setStatus("signed_out");
      } else {
        setProfile(null);
        setError(connectedMessage(caught));
        setStatus("error");
      }
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    const authorize = (nextUser: ProductionUser | null) => {
      if (!active) return;
      setProfile(null);
      setUser(nextUser);
      if (nextUser === null) {
        authorizationVersion.current += 1;
        setStatus("signed_out");
        setError(null);
      } else {
        void loadProfile(nextUser);
      }
    };
    const unsubscribe = api.auth.subscribe(authorize);
    if (api.auth.currentUser !== null) authorize(api.auth.currentUser);
    return () => { active = false; unsubscribe(); };
  }, [api, loadProfile]);

  useEffect(() => {
    if (currentRoute !== "invite" || status !== "ready" || user === null) return;
    const token = invitationToken.current;
    if (!token || invitation !== null) return;
    let active = true;
    void (async () => {
      try {
        const inspected = await api.inspectInvitation(token);
        if (active) setInvitation(inspected);
      } catch (caught) {
        if (active) setInvitationError(connectedMessage(caught));
      }
    })();
    return () => { active = false; };
  }, [api, currentRoute, invitation, status, user]);

  useEffect(() => {
    if (status !== "ready") return;
    const guard = resolveProtectedRoute(currentRoute, user !== null, profile);
    if (guard.redirect !== null) replacePath(guard.redirect);
  }, [currentRoute, profile, status, user]);

  /** Re-checks verification, then applies the role chosen at sign-up. */
  const completeSignUp = async () => {
    if (awaitingVerification === null) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await api.auth.isEmailVerified?.();
      if (verified !== true) {
        setError("This address is not verified yet. Open the link in your email, then try again.");
        return;
      }
      await api.onboard(awaitingVerification.role);
      const current = api.auth.currentUser;
      setAwaitingVerification(null);
      if (current !== null) await loadProfile(current);
    } catch (caught) {
      setError(connectedMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try { await loadProfile(await api.auth.signInWithGoogle()); }
    catch (caught) { setError(connectedMessage(caught)); setStatus("signed_out"); }
    finally { setBusy(false); }
  };

  /**
   * Sign-up captures the role up front and onboards with it immediately, so a
   * new account lands in its workspace rather than on a second screen. The role
   * is still only a request: the server decides, and Teacher stays pending
   * until an Admin approves it.
   */
  const submitCredentials = async () => {
    setBusy(true);
    setError(null);
    try {
      if (authMode === "sign_in") {
        await loadProfile(await api.auth.signInWithEmailPassword(credentials.email, credentials.password));
        return;
      }
      const created = api.auth.createAccountWithEmailPassword;
      if (created === undefined) throw new Error("Account creation is not enabled for this application");
      await created(credentials.email, credentials.password);
      // The server refuses to onboard an unverified principal, so hold the
      // chosen role until the address is confirmed rather than failing here.
      setAwaitingVerification({ email: credentials.email, role: signUpRole });
      setCredentials({ email: "", password: "" });
    } catch (caught) {
      setError(connectedMessage(caught));
      setStatus("signed_out");
    } finally {
      setBusy(false);
    }
  };
  const acceptInvitation = async () => {
    const token = invitationToken.current;
    if (!token) return;
    setBusy(true);
    setInvitationError(null);
    try {
      await api.acceptInvitation(token);
      invitationToken.current = null;
      if (user !== null) await loadProfile(user);
      setCurrentRoute("student");
      replacePath("/student");
    } catch (caught) {
      setInvitationError(connectedMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    authorizationVersion.current += 1;
    setUser(null);
    setProfile(null);
    setStatus("signed_out");
    replacePath("/");
    try { await api.auth.signOut(); } catch { setError("Sign-out could not be completed. Try again."); }
  };
  const onboard = async (role: "student" | "teacher") => {
    setProfile(null);
    setStatus("loading");
    try {
      const next = await api.onboard(role);
      setProfile(next);
      setStatus("ready");
      const destination = resolveDashboardRoute({ authenticated: true, profile: next });
      setCurrentRoute(requestedRouteForState(destination.state));
      replacePath(destination.canonicalPath);
    } catch (caught) { setError(connectedMessage(caught)); setStatus("error"); }
  };
  const switchRole = async (role: ConnectedDashboardRole) => {
    if (profile?.roles[role] !== "active") return;
    setProfile(null);
    setStatus("loading");
    try {
      const next = await api.setActiveRole(role);
      setProfile(next);
      setStatus("ready");
      const destination = resolveDashboardRoute({ authenticated: true, profile: next });
      setCurrentRoute(requestedRouteForState(destination.state));
      replacePath(destination.canonicalPath);
    } catch (caught) { setError(connectedMessage(caught)); setStatus("error"); }
  };

  if (status === "loading") return <main className="academic-auth-screen" aria-busy="true"><section className="academic-auth-card"><span className="academic-spinner" aria-hidden="true" /><p role="status">Checking your dashboard access…</p></section></main>;
  if (status === "error") return <main className="academic-auth-screen"><section className="academic-auth-card"><h1>Access could not be verified</h1><p role="alert">{error}</p></section></main>;
  if (awaitingVerification !== null) return (
    <main className="academic-auth-screen"><section className="academic-auth-card"><p className="academic-auth-brand">ViJEEta</p>
      <h1>Verify your email</h1>
      <p>We sent a verification link to {awaitingVerification.email}. Open it, then continue as a {awaitingVerification.role}.</p>
      <button className="academic-button academic-button--primary" disabled={busy} onClick={() => void completeSignUp()} type="button">
        {busy ? "Checking…" : "I have verified my email"}
      </button>
      <button className="academic-button academic-button--quiet" disabled={busy} onClick={() => { setAwaitingVerification(null); setError(null); }} type="button">Back to sign in</button>
      {error ? <p role="alert">{error}</p> : null}
    </section></main>
  );
  if (user === null || status === "signed_out") return (
    <main className="academic-auth-screen"><section className="academic-auth-card academic-auth-card--wide"><p className="academic-auth-brand">ViJEEta</p>
      <h1>{authMode === "sign_in" ? "Sign in to Vijeeta" : "Create your Vijeeta account"}</h1>
      <p>{authMode === "sign_in" ? "Teachers and students use the same secure sign-in." : "Choose how you will use Vijeeta. Admin access cannot be selected here."}</p>

      <div className="academic-auth-tabs" role="tablist" aria-label="Sign in or sign up">
        <button aria-selected={authMode === "sign_in"} className="academic-auth-tab" onClick={() => { setAuthMode("sign_in"); setError(null); }} role="tab" type="button">Sign in</button>
        <button aria-selected={authMode === "sign_up"} className="academic-auth-tab" onClick={() => { setAuthMode("sign_up"); setError(null); }} role="tab" type="button">Sign up</button>
      </div>

      <button className="academic-google-button" type="button" disabled={busy} onClick={() => void signIn()}><span aria-hidden="true">G</span>{busy ? "Signing in…" : "Continue with Google"}</button>

      <form className="academic-auth-form" onSubmit={(event) => { event.preventDefault(); void submitCredentials(); }}>
        <label className="academic-field" htmlFor="auth-email">Email
          <input autoComplete="email" id="auth-email" maxLength={320} onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))} required type="email" value={credentials.email} />
        </label>
        <label className="academic-field" htmlFor="auth-password">Password
          <input autoComplete={authMode === "sign_in" ? "current-password" : "new-password"} id="auth-password" minLength={8} maxLength={128} onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))} required type="password" value={credentials.password} />
        </label>

        {authMode === "sign_up" ? (
          <fieldset className="academic-role-options">
            <legend>I am a</legend>
            <label><input checked={signUpRole === "student"} name="signup-role" onChange={() => setSignUpRole("student")} type="radio" value="student" /><strong>Student</strong><small>Join classes and take assigned tests.</small></label>
            <label><input checked={signUpRole === "teacher"} name="signup-role" onChange={() => setSignUpRole("teacher")} type="radio" value="teacher" /><strong>Teacher</strong><small>Request approval to manage classes.</small></label>
          </fieldset>
        ) : null}

        <button className="academic-button academic-button--primary" disabled={busy} type="submit">
          {busy ? "Working…" : authMode === "sign_in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {authMode === "sign_up" ? <p className="academic-subtitle">An email-and-password account starts unverified. Most actions need a verified email, so Google sign-in is the quickest way in.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section></main>
  );

  const resolved = resolveDashboardRoute({ authenticated: true, profile });
  const guard = resolveProtectedRoute(currentRoute, true, profile);
  if (!guard.render) return <main className="academic-auth-screen"><section className="academic-auth-card" aria-busy="true"><p role="status">Redirecting to your authorized workspace…</p></section></main>;
  if (currentRoute === "invite") return (
    <main className="academic-auth-screen"><section className="academic-auth-card"><p className="academic-auth-brand">ViJEEta</p><h1>Classroom invitation</h1>
      {invitationLinkState === "missing" ? <p>Open the invitation link from your email to continue.</p> : null}
      {invitationLinkState === "captured" && invitation === null && invitationError === null ? <p role="status">Checking your invitation…</p> : null}
      {invitationError !== null ? <p role="alert">{invitationError}</p> : null}
      {invitation !== null ? (
        <>
          <p>{invitation.teacherDisplayName} invited you to join {invitation.classroomName}.</p>
          {invitation.targetEmailMatches ? (
            <button className="academic-button academic-button--primary" disabled={busy} onClick={() => void acceptInvitation()} type="button">
              {busy ? "Joining…" : "Join class"}
            </button>
          ) : <p role="alert">This invitation was sent to a different email address. Sign in with the address the invitation was sent to.</p>}
        </>
      ) : null}
    </section></main>
  );
  if (resolved.state === "onboarding") return (
    <main className="academic-auth-screen"><section className="academic-auth-card academic-auth-card--wide"><p className="academic-auth-brand">ViJEEta</p><h1>Choose your workspace</h1><p>Choose how you will use Vijeeta. Admin access cannot be selected here.</p>
      <div className="academic-role-options"><button type="button" aria-label="Continue as student" onClick={() => void onboard("student")}><span aria-hidden="true">▤</span><strong>Student</strong><small>Join classes and take assigned tests.</small></button>
      <button type="button" aria-label="Request Teacher access" onClick={() => void onboard("teacher")}><span aria-hidden="true">◇</span><strong>Teacher</strong><small>Request approval to manage classes.</small></button></div>
    </section></main>
  );
  if (resolved.state === "error" || resolved.state === "signed_out" || profile === null) return <main className="academic-auth-screen"><section className="academic-auth-card"><h1>Workspace unavailable</h1><p role="alert">The server profile has no active workspace.</p></section></main>;

  const activeRoles = (["student", "teacher", "admin"] as const).filter((role) => profile.roles[role] === "active");
  const workspaceNavigation = (exclude?: ConnectedDashboardRole) => (
    <nav aria-label="Available workspaces">
      {activeRoles.filter((role) => role !== exclude).map((role) => (
        <button key={role} type="button" onClick={() => void switchRole(role)}>{role[0]!.toUpperCase() + role.slice(1)} workspace</button>
      ))}
    </nav>
  );
  if (resolved.state === "pending_teacher") return (
    <main className="academic-auth-screen"><section className="academic-auth-card"><span className="academic-state-icon" aria-hidden="true">◷</span><h1>Teacher approval pending</h1><p>An Admin must approve Teacher access before you can continue.</p>{workspaceNavigation()}</section></main>
  );
  if (resolved.state === "suspended") return (
    <main className="academic-auth-screen"><section className="academic-auth-card"><span className="academic-state-icon academic-state-icon--warning" aria-hidden="true">!</span><h1>Workspace suspended</h1><p>This workspace is unavailable. Choose another active workspace or contact an administrator.</p>{workspaceNavigation()}</section></main>
  );
  if (resolved.state === "admin") return (
    <AcademicShell
      profile={{ displayName: profile.displayName, email: profile.verifiedEmail, activeRole: "admin" }}
      navigation={[
        { label: "Overview", href: "/admin", icon: "⌂" },
        { label: "Profiles", href: "/admin#admin-profiles", icon: "◎" },
        { label: "Classes", href: "/admin#admin-classes", icon: "◇" },
        { label: "Invitations", href: "/admin#admin-invitations", icon: "✉" },
        { label: "Audit", href: "/admin#admin-audit", icon: "✓" },
      ]}
      currentHref="/admin"
      workspaceActions={activeRoles.filter((role) => role !== "admin")}
      onWorkspaceSwitch={(role) => void switchRole(role)}
      onSignOut={() => void signOut()}
    >
      <AdminDashboard />
    </AcademicShell>
  );
  if (resolved.state === "teacher") return (
    <AcademicShell
      profile={{ displayName: profile.displayName, email: profile.verifiedEmail, activeRole: "teacher" }}
      navigation={[
        { label: "Classes", href: "/teacher#teacher-classes", icon: "⌂" },
        { label: "Roster", href: "/teacher#teacher-roster", icon: "◎" },
        { label: "Assignments", href: "/teacher#teacher-assignments", icon: "◇" },
        { label: "Insights", href: "/teacher#teacher-insights", icon: "▤" },
      ]}
      currentHref="/teacher#teacher-classes"
      workspaceActions={activeRoles.filter((role) => role !== "teacher")}
      onWorkspaceSwitch={(role) => void switchRole(role)}
      onSignOut={() => void signOut()}
    >
      <ConnectedTeacherDashboard onAuthorizationLost={() => { if (user) void loadProfile(user); }} />
    </AcademicShell>
  );
  return (
    <AcademicShell
      profile={{ displayName: profile.displayName, email: profile.verifiedEmail, activeRole: "student" }}
      navigation={[
        { label: "Assigned tests", href: "/student#student-tests", icon: "⌂" },
        { label: "Results", href: "/student#student-results", icon: "▤" },
      ]}
      currentHref="/student#student-tests"
      workspaceActions={activeRoles.filter((role) => role !== "student")}
      onWorkspaceSwitch={(role) => void switchRole(role)}
      onSignOut={() => void signOut()}
    >
      <ConnectedStudentDashboard
        onAuthorizationLost={() => { if (user) void loadProfile(user); }}
        onLaunch={(runnerPath) => { window.location.assign(runnerPath); }}
      />
    </AcademicShell>
  );
}

export function ProductionDashboard({ api: suppliedApi }: { api?: ProductionApiLike }) {
  const api = useMemo(() => suppliedApi ?? createProductionApi({ auth: createFirebaseAuth() }), [suppliedApi]);
  const [user, setUser] = useState(api.auth.currentUser);
  const [profile, setProfile] = useState<ProductionProfile | null>(null);
  const [viewState, setViewState] = useState<ViewState>(user ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!api.auth.currentUser) {
      setUser(null);
      setProfile(null);
      setViewState("ready");
      return;
    }
    setViewState("loading");
    setError(null);
    try {
      const next = await api.getProfile();
      setProfile(next);
      setUser(api.auth.currentUser);
      setViewState(!next || !next.onboardingComplete || !next.activeRole ? "onboarding" : "ready");
    } catch (caught) {
      setViewState("error");
      setError(messageFor(caught));
    }
  }, [api]);

  useEffect(() => api.auth.subscribe((nextUser) => {
    setUser(nextUser);
    if (nextUser) void loadProfile();
    else { setProfile(null); setViewState("ready"); }
  }), [api, loadProfile]);

  useEffect(() => { if (user) void loadProfile(); }, [user, loadProfile]);

  const chooseRole = async (role: ProductionRole) => {
    setError(null);
    try {
      const next = await api.onboard(role);
      setProfile(next);
      setViewState("ready");
      window.history.pushState({}, "", `/dashboard/${role}`);
    } catch (caught) {
      setError(messageFor(caught));
    }
  };

  if (!user) return <><SignedOut api={api} onError={(caught) => setError(messageFor(caught))} />{error ? <p role="alert">{error}</p> : null}</>;
  if (viewState === "loading") return <p role="status">Loading your production profile…</p>;
  if (viewState === "error") return <p role="alert">{error}</p>;
  if (viewState === "onboarding") return <><p>Signed in as {user.email ?? user.displayName}</p><RoleChoice profile={profile} onChoose={chooseRole} />{error ? <p role="alert">{error}</p> : null}</>;

  const role = requestedRole() ?? profile?.activeRole;
  if (!role || !profile?.allowedRoles.includes(role)) {
    return <p role="alert">You are not authorized for this dashboard view.</p>;
  }
  return (
    <main className="production-dashboard">
      <header>
        <p>Signed in as {user.email ?? user.displayName}</p>
        <button type="button" onClick={() => void api.auth.signOut()}>Log out</button>
      </header>
      <h1>{role === "student" ? "Student dashboard" : "Teacher dashboard"}</h1>
      <ProductionReadView role={role} api={api} />
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
