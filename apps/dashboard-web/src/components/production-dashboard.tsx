"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConnectedDashboardRole, DashboardProfileV2 } from "@vijeeta/api-contracts";

import { createConnectedApi, ConnectedApiError } from "@/client/connected-api";
import { createFirebaseAuth } from "@/client/firebase-auth";
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
  return { auth, getProfile: connected.getProfile, onboard: connected.onboard, setActiveRole: connected.setActiveRole };
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

/** Functional role gate. Task 10/11 replace these states with the final Academic Precision views. */
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
  const [invitationLinkState, setInvitationLinkState] = useState<"unchecked" | "captured" | "missing">("unchecked");
  const authorizationVersion = useRef(0);
  const invitationToken = useRef<string | null | undefined>(undefined);

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
    if (status !== "ready") return;
    const guard = resolveProtectedRoute(requestedRoute, user !== null, profile);
    if (guard.redirect !== null) replacePath(guard.redirect);
  }, [profile, requestedRoute, status, user]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try { await loadProfile(await api.auth.signInWithGoogle()); }
    catch (caught) { setError(connectedMessage(caught)); setStatus("signed_out"); }
    finally { setBusy(false); }
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
      replacePath(resolveDashboardRoute({ authenticated: true, profile: next }).canonicalPath);
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
      replacePath(resolveDashboardRoute({ authenticated: true, profile: next }).canonicalPath);
    } catch (caught) { setError(connectedMessage(caught)); setStatus("error"); }
  };

  if (status === "loading") return <p role="status">Checking your dashboard access…</p>;
  if (status === "error") return <p role="alert">{error}</p>;
  if (user === null || status === "signed_out") return (
    <main><h1>Sign in to Vijeeta</h1><p>Use Google to sign in or create your account.</p>
      <button type="button" disabled={busy} onClick={() => void signIn()}>{busy ? "Signing in…" : "Continue with Google"}</button>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );

  const resolved = resolveDashboardRoute({ authenticated: true, profile });
  if (requestedRoute === "invite") return (
    <main><h1>Classroom invitation</h1><p>{invitationLinkState === "missing" ? "Open the invitation link from your email to continue." : "Your invitation is held only in this tab while we verify it."}</p></main>
  );
  if (resolved.state === "onboarding") return (
    <main><h1>Choose your workspace</h1><p>Admin access cannot be selected here.</p>
      <button type="button" onClick={() => void onboard("student")}>Continue as student</button>
      <button type="button" onClick={() => void onboard("teacher")}>Request Teacher access</button>
    </main>
  );
  if (resolved.state === "pending_teacher") return <main><h1>Teacher approval pending</h1><p>An Admin must approve Teacher access before you can continue.</p></main>;
  if (resolved.state === "suspended") return <main><h1>Workspace suspended</h1><p>This workspace is unavailable. Contact an administrator.</p></main>;
  if (resolved.state === "error" || profile === null) return <p role="alert">The server profile has no active workspace.</p>;

  const activeRoles = (["student", "teacher", "admin"] as const).filter((role) => profile.roles[role] === "active");
  return (
    <main>
      <header><p>Signed in as {profile.verifiedEmail ?? profile.displayName}</p><button type="button" onClick={() => void signOut()}>Log out</button></header>
      <h1>{resolved.state[0]!.toUpperCase() + resolved.state.slice(1)} workspace</h1>
      <nav aria-label="Available workspaces">
        {activeRoles.filter((role) => role !== resolved.state).map((role) => (
          <button key={role} type="button" onClick={() => void switchRole(role)}>{role[0]!.toUpperCase() + role.slice(1)} workspace</button>
        ))}
      </nav>
      <p>Your access was verified from your server profile.</p>
    </main>
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
