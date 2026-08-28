"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { ConnectedDashboardRole } from "@vijeeta/api-contracts";

export interface AcademicNavigationItem {
  label: string;
  href: string;
  icon: string;
}

export interface AcademicShellProfile {
  displayName: string | null;
  email: string | null;
  activeRole: ConnectedDashboardRole;
}

export function AcademicShell({
  children,
  profile,
  navigation,
  currentHref,
  onSignOut,
  workspaceActions = [],
  onWorkspaceSwitch,
}: {
  children: ReactNode;
  profile: AcademicShellProfile;
  navigation: readonly AcademicNavigationItem[];
  currentHref: string;
  onSignOut?: () => void;
  workspaceActions?: readonly ConnectedDashboardRole[];
  onWorkspaceSwitch?: (role: ConnectedDashboardRole) => void;
}) {
  const [activeHref, setActiveHref] = useState(currentHref);
  useEffect(() => {
    const syncLocation = () => {
      const browserHref = `${window.location.pathname}${window.location.hash}`;
      setActiveHref(navigation.some((item) => item.href === browserHref) ? browserHref : currentHref);
    };
    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, [currentHref, navigation]);
  const displayName = profile.displayName ?? profile.email ?? "Signed-in user";
  const roleLabel = `${profile.activeRole[0]!.toUpperCase()}${profile.activeRole.slice(1)} workspace`;
  const links = (mobile = false) => navigation.map((item) => {
    const active = item.href === activeHref;
    return (
      <a
        className={mobile ? "academic-shell__mobile-link" : "academic-shell__nav-link"}
        data-active={active ? "true" : "false"}
        href={item.href}
        onClick={(event) => {
          if (!item.href.startsWith("/")) return;
          event.preventDefault();
          window.history.pushState({}, "", item.href);
          setActiveHref(item.href);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }}
        key={`${mobile ? "mobile" : "desktop"}-${item.href}`}
        aria-current={active ? "page" : undefined}
      >
        <span className="academic-shell__nav-icon" aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </a>
    );
  });

  return (
    <div className="academic-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="academic-shell__sidebar">
        <div className="academic-shell__brand" aria-label="Vijeeta Learning Portal">
          <span className="academic-shell__brand-mark" aria-hidden="true">V</span>
          <span><strong>ViJEEta</strong><small>Learning Portal</small></span>
        </div>
        <nav className="academic-shell__desktop-nav" aria-label="Primary navigation">{links()}</nav>
        <div className="academic-shell__profile">
          <span className="academic-shell__avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{displayName}</strong><small>{roleLabel}</small></span>
        </div>
      </aside>
      <div className="academic-shell__body">
        <header className="academic-shell__header">
          <a className="academic-shell__mobile-brand" href={currentHref}>ViJEEta</a>
          {workspaceActions.length ? (
            <nav className="academic-shell__workspace-actions" aria-label="Available workspaces">
              {workspaceActions.map((role) => <button type="button" key={role} onClick={() => onWorkspaceSwitch?.(role)}>Switch to {role}</button>)}
            </nav>
          ) : null}
          <span className="academic-shell__workspace-pill"><span aria-hidden="true">●</span>{roleLabel}</span>
          {onSignOut ? <button className="academic-button academic-button--quiet" type="button" onClick={onSignOut}>Log out</button> : null}
        </header>
        <main className="academic-shell__main" id="main-content">
          <div className="academic-shell__content-grid">{children}</div>
        </main>
      </div>
      <nav className="academic-shell__mobile-nav" aria-label="Mobile navigation">{links(true)}</nav>
    </div>
  );
}
