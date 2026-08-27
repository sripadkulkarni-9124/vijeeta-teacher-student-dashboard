# Vijeeta Dashboard Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a polished fixture-mode teacher/student dashboard demo with one role-aware entry point.

**Architecture:** One Next.js app serves both the browser UI and isolated typed API route handlers. A Git-ignored JSON store persists demo mutations locally; messaging and live test-engine ports have capture-only adapters. Shared V2 configuration and design-system packages remain the only copied platform dependencies.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest 4, Testing Library, CSS custom properties, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-08-27-vijeeta-dashboard-prototype-design.md`

## Global Constraints

- Local HTTP and local JSON persistence only; no Firebase, Firestore, GCP, production authentication, deployment, V3/V4 calls, or live communication sends.
- One role-aware app; existing Vijeeta sources remain read-only.
- Accessible controls, meaningful status text, and responsive layouts.

---

### Task 1: Independent baseline

**Files:** root workspace files, shared packages, `docs/PROVENANCE.md`

- [x] Export only tracked shared workspace files from curated commit `7dbb47b`.
- [x] Exclude `.git`, caches, backends, mobile apps, and content archives.
- [ ] Verify shared package tests, types, and lint.
- [ ] Commit the independent baseline.

### Task 2: Typed local API and persistent fixture domain

**Files:** shared contracts, server store/adapters, `/api` route handlers, matching tests.

- [ ] Write failing tests for schema validation, role snapshots, persistence, invitations, assignments, attempts, and captured external messages.
- [ ] Implement the minimal JSON-backed store and route handlers.
- [ ] Add a route-handler smoke test for the full mutation/read loop.
- [ ] Run focused tests and commit.

### Task 3: Common shell and student journey

**Files:** landing, role shell, student dashboard/detail components, matching tests.

- [ ] Write failing role-entry and student-journey tests.
- [ ] Implement common simulated sign-in, role switch, class/test states, and personal insights.
- [ ] Verify focused tests and commit.

### Task 4: Teacher journey

**Files:** teacher dashboard, roster/invitation, quick-create, assignment, and insights components with tests.

- [ ] Write failing teacher journey tests.
- [ ] Implement class/roster, invitation preview, quick-create, More settings, assignment status, and insights.
- [ ] Verify focused tests and commit.

### Task 5: Polish, state variants, and handoff

**Files:** shared styles, state panels, README.

- [ ] Add responsive styling and practical loading/empty/error states.
- [ ] Document exact local run commands and fixture limitations.
- [ ] Run full lint, typecheck, tests, and production build; fix only demonstrated failures.
- [ ] Commit the verified prototype.
