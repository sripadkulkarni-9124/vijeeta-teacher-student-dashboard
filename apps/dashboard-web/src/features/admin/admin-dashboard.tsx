"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type {
  AdminAuditListResponse,
  AdminInvitationListResponse,
  AdminProfileListResponse,
  Classroom,
  ClassroomInviteProjection,
  ClassroomListResponse,
  DashboardProfileV2,
} from "@vijeeta/api-contracts";

import { createConnectedApi, type ConnectedApi } from "@/client/connected-api";
import { createFirebaseAuth } from "@/client/firebase-auth";

export const ADMIN_CLIENT_METHODS = [
  "listAdminProfiles",
  "approveTeacher",
  "suspendTeacher",
  "listAdminClassrooms",
  "archiveAdminClassroom",
  "restoreAdminClassroom",
  "listAdminInvitations",
  "revokeAdminInvitation",
  "redeliverAdminInvitation",
  "listAdminAudit",
] as const;

export type AdminDashboardApi = Pick<ConnectedApi, (typeof ADMIN_CLIENT_METHODS)[number]>;

type AdminData = {
  profiles: DashboardProfileV2[];
  classrooms: Classroom[];
  invitations: ClassroomInviteProjection[];
  audit: AdminAuditListResponse["events"];
};

type CursorState = { profiles: string | null; classrooms: string | null; invitations: string | null; audit: string | null };
type FocusTarget = keyof CursorState | "denied";
type ActionKind = "approve" | "suspend" | "archive" | "restore" | "revoke" | "redeliver";
type PendingAction = { kind: ActionKind; id: string; label: string };

const EMPTY_DATA: AdminData = { profiles: [], classrooms: [], invitations: [], audit: [] };
const EMPTY_CURSORS: CursorState = { profiles: null, classrooms: null, invitations: null, audit: null };
const PAGE_SIZE = 50;
const ADMIN_SECTION_HASHES = ["#admin-profiles", "#admin-classes", "#admin-invitations", "#admin-audit"] as const;

function currentAdminSection(): string {
  if (typeof window === "undefined") return "";
  return ADMIN_SECTION_HASHES.includes(window.location.hash as (typeof ADMIN_SECTION_HASHES)[number]) ? window.location.hash : "";
}

function appendUnique<T extends { id?: string; firebaseUid?: string }>(current: T[], incoming: T[]): T[] {
  const keys = new Set(current.map((item) => item.id ?? item.firebaseUid));
  return [...current, ...incoming.filter((item) => !keys.has(item.id ?? item.firebaseUid))];
}

const ACTION_COPY: Record<ActionKind, { title: string; confirm: string; progress: string; consequence: string; success: string }> = {
  approve: { title: "Approve Teacher", confirm: "Approve Teacher", progress: "Approving…", consequence: "This grants Teacher workspace access. It does not grant Admin access.", success: "Teacher approved" },
  suspend: { title: "Suspend Teacher", confirm: "Suspend Teacher", progress: "Suspending…", consequence: "This blocks Teacher workspace access. Existing data is retained and is not deleted.", success: "Teacher suspended" },
  archive: { title: "Archive Class", confirm: "Archive Class", progress: "Archiving…", consequence: "Archiving hides the class from active work. It does not delete the class or its history.", success: "Class archived" },
  restore: { title: "Restore Class", confirm: "Restore Class", progress: "Restoring…", consequence: "This returns the archived class to active class listings.", success: "Class restored" },
  revoke: { title: "Revoke Invitation", confirm: "Revoke Invitation", progress: "Revoking…", consequence: "The invitation cannot be accepted after revocation. Existing memberships are unchanged.", success: "Invitation revoked" },
  redeliver: { title: "Request Invitation Redelivery", confirm: "Request Redelivery", progress: "Requesting…", consequence: "This records a delivery request intent. It does not confirm that an email was sent.", success: "Invitation redelivery requested" },
};

function defaultApi(): AdminDashboardApi {
  const auth = createFirebaseAuth();
  return createConnectedApi({ getIdToken: (forceRefresh) => auth.getIdToken(forceRefresh) });
}

function statusIcon(status: string): string {
  if (["active", "accepted", "sent"].includes(status)) return "✓";
  if (["pending", "redelivery_requested", "unknown"].includes(status)) return "◷";
  if (["suspended", "failed", "revoked", "expired", "archived", "rejected"].includes(status)) return "!";
  return "•";
}

function Status({ value }: { value: string }) {
  const words = value.replaceAll("_", " ");
  const label = `${words[0]!.toUpperCase()}${words.slice(1)}`;
  return <span className={`academic-status academic-status--${value}`}><span aria-hidden="true">{statusIcon(value)}</span>{label}</span>;
}

function failureCopy(error: unknown): { denied: boolean; message: string } {
  const candidate = error && typeof error === "object" ? error as { status?: number; correlationId?: string } : {};
  const safeCorrelationId = typeof candidate.correlationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate.correlationId)
    ? candidate.correlationId
    : null;
  if (candidate.status === 401 || candidate.status === 403) {
    return { denied: true, message: "Administration access could not be verified. Sign in again or contact an administrator." };
  }
  return {
    denied: false,
    message: `The action could not be completed.${safeCorrelationId ? ` Reference: ${safeCorrelationId}.` : " Try again."}`,
  };
}

function ReasonDialog({ action, busy, onCancel, onConfirm }: {
  action: PendingAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const copy = ACTION_COPY[action.kind];
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])") ?? []);
    const first = controls[0];
    const last = controls.at(-1);
    if (!controls.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <div className="academic-dialog-backdrop" role="presentation">
      <section ref={dialog} className="academic-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-action-title" aria-describedby="admin-action-consequence" onKeyDown={handleKeyDown}>
        <div className="academic-dialog__header">
          <div><p className="academic-overline">Confirmation required</p><h2 id="admin-action-title">{copy.title}</h2></div>
          <button className="academic-icon-button" type="button" aria-label="Close confirmation" disabled={busy} onClick={onCancel}>×</button>
        </div>
        <p id="admin-action-consequence">{copy.consequence}</p>
        <p className="academic-dialog__target">Target: <strong>{action.label}</strong></p>
        <label className="academic-field">
          <span>Reason</span>
          <textarea ref={input} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="admin-reason-help" />
          <small id="admin-reason-help">Required. Up to 500 characters; retained in the immutable audit trail.</small>
        </label>
        <div className="academic-dialog__actions">
          <button className="academic-button academic-button--quiet" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="academic-button academic-button--primary" type="button" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {busy ? copy.progress : copy.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AdminDashboard({ api: suppliedApi }: { api?: AdminDashboardApi }) {
  const api = useMemo(() => suppliedApi ?? defaultApi(), [suppliedApi]);
  const [data, setData] = useState<AdminData>(EMPTY_DATA);
  const [cursors, setCursors] = useState<CursorState>(EMPTY_CURSORS);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [currentSection, setCurrentSection] = useState(currentAdminSection);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const actionTriggerName = useRef<string | null>(null);
  const deniedHeading = useRef<HTMLHeadingElement>(null);
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const classroomHeading = useRef<HTMLHeadingElement>(null);
  const invitationHeading = useRef<HTMLHeadingElement>(null);
  const auditHeading = useRef<HTMLHeadingElement>(null);

  const openAction = (next: PendingAction, trigger: HTMLElement) => {
    actionTrigger.current = trigger;
    actionTriggerName.current = actionTrigger.current?.getAttribute("aria-label") ?? null;
    setAction(next);
  };

  const cancelAction = () => {
    const trigger = actionTrigger.current;
    setAction(null);
    queueMicrotask(() => trigger?.focus());
  };

  useEffect(() => {
    if (!focusTarget || action) return;
    queueMicrotask(() => {
      const fallback = {
        denied: deniedHeading.current,
        profiles: profileHeading.current,
        classrooms: classroomHeading.current,
        invitations: invitationHeading.current,
        audit: auditHeading.current,
      }[focusTarget];
      const trigger = actionTrigger.current;
      const triggerSurvived = trigger?.isConnected && trigger.getAttribute("aria-label") === actionTriggerName.current;
      (triggerSurvived ? trigger : fallback)?.focus();
      setFocusTarget(null);
    });
  }, [action, focusTarget, state]);

  const handleFailure = useCallback((error: unknown) => {
    const next = failureCopy(error);
    if (next.denied) {
      setData(EMPTY_DATA);
      setCursors(EMPTY_CURSORS);
      setState("denied");
      setFocusTarget("denied");
    } else setState("error");
    setFailure(next.message);
  }, []);

  const refreshAll = useCallback(async () => {
    setState("loading");
    setFailure(null);
    try {
      const [profilePage, classroomPage, invitationPage, auditPage] = await Promise.all([
        api.listAdminProfiles({ limit: PAGE_SIZE }), api.listAdminClassrooms({ limit: PAGE_SIZE }),
        api.listAdminInvitations({ limit: PAGE_SIZE }), api.listAdminAudit({ limit: PAGE_SIZE }),
      ]);
      setData({ profiles: profilePage.profiles, classrooms: classroomPage.classrooms, invitations: invitationPage.invitations, audit: auditPage.events });
      setCursors({ profiles: profilePage.nextCursor, classrooms: classroomPage.nextCursor, invitations: invitationPage.nextCursor, audit: auditPage.nextCursor });
      setRefreshedAt(new Date());
      setState("ready");
    } catch (error) { handleFailure(error); }
  }, [api, handleFailure]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  useEffect(() => {
    const syncSection = () => setCurrentSection(currentAdminSection());
    window.addEventListener("hashchange", syncSection);
    window.addEventListener("popstate", syncSection);
    return () => {
      window.removeEventListener("hashchange", syncSection);
      window.removeEventListener("popstate", syncSection);
    };
  }, []);

  const refreshCollection = async (kind: keyof CursorState) => {
    if (kind === "profiles") {
      const response = await api.listAdminProfiles({ limit: PAGE_SIZE });
      setData((current) => ({ ...current, profiles: response.profiles }));
      setCursors((current) => ({ ...current, profiles: response.nextCursor }));
    } else if (kind === "classrooms") {
      const response = await api.listAdminClassrooms({ limit: PAGE_SIZE });
      setData((current) => ({ ...current, classrooms: response.classrooms }));
      setCursors((current) => ({ ...current, classrooms: response.nextCursor }));
    } else if (kind === "invitations") {
      const response = await api.listAdminInvitations({ limit: PAGE_SIZE });
      setData((current) => ({ ...current, invitations: response.invitations }));
      setCursors((current) => ({ ...current, invitations: response.nextCursor }));
    } else {
      const response = await api.listAdminAudit({ limit: PAGE_SIZE });
      setData((current) => ({ ...current, audit: response.events }));
      setCursors((current) => ({ ...current, audit: response.nextCursor }));
    }
    setRefreshedAt(new Date());
  };

  const loadMore = async (kind: keyof CursorState) => {
    const cursor = cursors[kind];
    if (!cursor) return;
    try {
      if (kind === "profiles") {
        const response: AdminProfileListResponse = await api.listAdminProfiles({ cursor, limit: PAGE_SIZE });
        setData((current) => ({ ...current, profiles: appendUnique(current.profiles, response.profiles) }));
        setCursors((current) => ({ ...current, profiles: response.nextCursor }));
      } else if (kind === "classrooms") {
        const response: ClassroomListResponse = await api.listAdminClassrooms({ cursor, limit: PAGE_SIZE });
        setData((current) => ({ ...current, classrooms: appendUnique(current.classrooms, response.classrooms) }));
        setCursors((current) => ({ ...current, classrooms: response.nextCursor }));
      } else if (kind === "invitations") {
        const response: AdminInvitationListResponse = await api.listAdminInvitations({ cursor, limit: PAGE_SIZE });
        setData((current) => ({ ...current, invitations: appendUnique(current.invitations, response.invitations) }));
        setCursors((current) => ({ ...current, invitations: response.nextCursor }));
      } else {
        const response = await api.listAdminAudit({ cursor, limit: PAGE_SIZE });
        setData((current) => ({ ...current, audit: appendUnique(current.audit, response.events) }));
        setCursors((current) => ({ ...current, audit: response.nextCursor }));
      }
    } catch (error) { handleFailure(error); }
  };

  const confirmAction = async (reason: string) => {
    if (!action) return;
    setActionBusy(true);
    setFeedback(null);
    setFailure(null);
    const affectedCollection: keyof CursorState = action.kind === "approve" || action.kind === "suspend"
      ? "profiles"
      : action.kind === "archive" || action.kind === "restore"
        ? "classrooms"
        : "invitations";
    try {
      if (action.kind === "approve") { await api.approveTeacher(action.id, { reason }); await refreshCollection("profiles"); }
      if (action.kind === "suspend") { await api.suspendTeacher(action.id, { reason }); await refreshCollection("profiles"); }
      if (action.kind === "archive") { await api.archiveAdminClassroom(action.id, { reason }); await refreshCollection("classrooms"); }
      if (action.kind === "restore") { await api.restoreAdminClassroom(action.id, { reason }); await refreshCollection("classrooms"); }
      if (action.kind === "revoke") { await api.revokeAdminInvitation(action.id, { reason }); await refreshCollection("invitations"); }
      if (action.kind === "redeliver") { await api.redeliverAdminInvitation(action.id, { reason }); await refreshCollection("invitations"); }
      setFeedback(`${ACTION_COPY[action.kind].success}. Data refreshed from the server.`);
      setAction(null);
      setFocusTarget(affectedCollection);
    } catch (error) {
      const next = failureCopy(error);
      if (next.denied) { setData(EMPTY_DATA); setCursors(EMPTY_CURSORS); setState("denied"); setAction(null); setFocusTarget("denied"); }
      setFailure(next.message);
    } finally { setActionBusy(false); }
  };

  const filteredProfiles = data.profiles.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || [item.displayName, item.verifiedEmail, item.firebaseUid].some((value) => value?.toLowerCase().includes(query));
  });

  if (state === "loading") return <section className="admin-state" aria-busy="true"><span className="academic-spinner" aria-hidden="true" /><p role="status">Loading administration data…</p></section>;
  if (state === "denied") return <section className="admin-state"><h2 ref={deniedHeading} tabIndex={-1}>Administration unavailable</h2><p role="alert">{failure}</p></section>;

  return (
    <section className="admin-dashboard" aria-busy={actionBusy}>
      <div className="admin-dashboard__heading">
        <div><p className="academic-overline">Protected operations</p><h1>Administration</h1><p>Manage dashboard access and metadata without exposing student assessment content.</p></div>
        <button className="academic-button academic-button--secondary" type="button" onClick={() => void refreshAll()}>Refresh all</button>
      </div>
      <nav className="admin-section-nav" aria-label="Administration sections">
        {ADMIN_SECTION_HASHES.map((href) => {
          const label = { "#admin-profiles": "Profiles", "#admin-classes": "Classes", "#admin-invitations": "Invitations", "#admin-audit": "Audit" }[href];
          const select = () => {
            window.history.pushState({}, "", href);
            setCurrentSection(href);
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          };
          return <a key={href} href={href} aria-current={currentSection === href ? "location" : undefined} onClick={(event) => { event.preventDefault(); select(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); select(); } }}>{label}</a>;
        })}
      </nav>
      {refreshedAt ? <p className="academic-freshness">Last refreshed {refreshedAt.toLocaleTimeString()} · server-authorized data</p> : null}
      {feedback ? <p className="academic-feedback academic-feedback--success" role="status">✓ {feedback}</p> : null}
      {failure ? <p className="academic-feedback academic-feedback--error" role="alert">! {failure}</p> : null}

      <article className="academic-card admin-panel" id="admin-profiles">
        <div className="admin-panel__header"><div><p className="academic-overline">Access control</p><h2 ref={profileHeading} tabIndex={-1}>Profiles &amp; Teacher state</h2></div>
          <label className="academic-search"><span>Search loaded profiles</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Name, email, or UID" /></label>
        </div>
        <div className="academic-table-wrap"><table><caption>Redacted dashboard profiles loaded from the Admin API</caption><thead><tr><th scope="col">Profile</th><th scope="col">Roles</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead>
          <tbody>{filteredProfiles.length ? filteredProfiles.map((item) => {
            const teacher = item.roles.teacher;
            const label = item.displayName ?? item.verifiedEmail ?? item.firebaseUid;
            return <tr key={item.firebaseUid}><td><strong>{label}</strong><small>{item.verifiedEmail ?? "Verified email unavailable"}</small></td><td><div className="academic-status-list">{Object.entries(item.roles).map(([role, status]) => <span key={role}><b>{role}</b><Status value={status} /></span>)}</div></td><td>{new Date(item.updatedAt).toLocaleDateString()}</td><td><div className="academic-row-actions">
              {teacher === "pending" ? <button type="button" onClick={(event) => openAction({ kind: "approve", id: item.firebaseUid, label }, event.currentTarget)} aria-label={`Approve Teacher ${label}`}>Approve</button> : null}
              {teacher === "active" ? <button type="button" onClick={(event) => openAction({ kind: "suspend", id: item.firebaseUid, label }, event.currentTarget)} aria-label={`Suspend Teacher ${label}`}>Suspend</button> : null}
            </div></td></tr>;
          }) : <tr><td colSpan={4} className="academic-empty">No loaded profiles match this view.</td></tr>}</tbody></table></div>
        {cursors.profiles ? <button className="academic-load-more" type="button" onClick={() => void loadMore("profiles")}>Load more profiles</button> : null}
      </article>

      <article className="academic-card admin-panel" id="admin-classes">
        <div className="admin-panel__header"><div><p className="academic-overline">Class metadata</p><h2 ref={classroomHeading} tabIndex={-1}>Classes</h2></div></div>
        <div className="academic-table-wrap"><table><caption>Teacher-owned class metadata</caption><thead><tr><th scope="col">Class</th><th scope="col">Owner UID</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>
          {data.classrooms.length ? data.classrooms.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{item.ownerUid}</td><td><Status value={item.status} /></td><td><div className="academic-row-actions">
            <button type="button" onClick={(event) => openAction({ kind: item.status === "active" ? "archive" : "restore", id: item.id, label: item.name }, event.currentTarget)} aria-label={`${item.status === "active" ? "Archive" : "Restore"} class ${item.name}`}>{item.status === "active" ? "Archive" : "Restore"}</button>
          </div></td></tr>) : <tr><td colSpan={4} className="academic-empty">No classes are available.</td></tr>}
        </tbody></table></div>{cursors.classrooms ? <button className="academic-load-more" type="button" onClick={() => void loadMore("classrooms")}>Load more classes</button> : null}
      </article>

      <article className="academic-card admin-panel" id="admin-invitations">
        <div className="admin-panel__header"><div><p className="academic-overline">Delivery state</p><h2 ref={invitationHeading} tabIndex={-1}>Invitations</h2></div></div>
        <div className="academic-table-wrap"><table><caption>Redacted invitation status and delivery intent</caption><thead><tr><th scope="col">Invitation</th><th scope="col">Class</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead><tbody>
          {data.invitations.length ? data.invitations.map((item) => <tr key={item.id}><td><strong>{item.id}</strong><small>Expires {new Date(item.expiresAt).toLocaleDateString()}</small></td><td>{item.classroomId}</td><td><div className="academic-status-list"><Status value={item.status} /><Status value={item.delivery} /></div></td><td><div className="academic-row-actions">
            {item.status === "pending" ? <button type="button" onClick={(event) => openAction({ kind: "revoke", id: item.id, label: item.id }, event.currentTarget)} aria-label={`Revoke invitation ${item.id}`}>Revoke</button> : null}
            {item.status === "pending" ? <button type="button" onClick={(event) => openAction({ kind: "redeliver", id: item.id, label: item.id }, event.currentTarget)} aria-label={`Request redelivery for invitation ${item.id}`}>Request redelivery</button> : null}
          </div></td></tr>) : <tr><td colSpan={4} className="academic-empty">No invitations are available.</td></tr>}
        </tbody></table></div>{cursors.invitations ? <button className="academic-load-more" type="button" onClick={() => void loadMore("invitations")}>Load more invitations</button> : null}
      </article>

      <article className="academic-card admin-panel" id="admin-audit">
        <div className="admin-panel__header"><div><p className="academic-overline">Immutable record</p><h2 ref={auditHeading} tabIndex={-1}>Audit feed</h2></div></div>
        <div className="academic-table-wrap"><table><caption>Immutable, redacted administrative audit events</caption><thead><tr><th scope="col">Event</th><th scope="col">Target</th><th scope="col">Reason</th><th scope="col">Created</th></tr></thead><tbody>
          {data.audit.length ? data.audit.map((item) => <tr key={item.id}><td><strong>{item.action}</strong><small>{item.correlationId}</small></td><td>{item.targetType}: {item.targetId}</td><td>{item.reason ?? "System action"}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>) : <tr><td colSpan={4} className="academic-empty">No audit events are available.</td></tr>}
        </tbody></table></div>{cursors.audit ? <button className="academic-load-more" type="button" onClick={() => void loadMore("audit")}>Load more audit events</button> : null}
      </article>
      {action ? <ReasonDialog action={action} busy={actionBusy} onCancel={cancelAction} onConfirm={(reason) => void confirmAction(reason)} /> : null}
    </section>
  );
}
