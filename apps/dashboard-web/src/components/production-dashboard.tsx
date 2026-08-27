"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createFirebaseAuth } from "@/client/firebase-auth";
import {
  createProductionApi,
  ProductionApiError,
  type ProductionApi,
  type ProductionProfile,
  type ProductionRole,
} from "@/client/production-api";

export type { ProductionAuthSession, ProductionProfile } from "@/client/production-api";

export type ProductionApiLike = ProductionApi;

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
