# Vijeeta teacher-student dashboard prototype design

**Status:** Approved for the two-hour fixture-mode demonstration

## Outcome

Build one locally runnable web application with a common simulated sign-in and role switch. Student and teacher journeys use synthetic in-memory data and share a calm, responsive shell.

## Architecture

`apps/dashboard-web` owns routes, browser interaction state, and isolated Next.js `/api` route handlers. Browser code calls typed HTTP endpoints. Server handlers validate input and delegate to a `DashboardStore` backed by a Git-ignored local JSON file so invitations, drafts, assignments, attempts, and results survive a local restart. Shared configuration, design-system primitives, and platform fixture types come from the curated V2 snapshot.

## First vertical slice

- Common landing with Teacher and Student demo entry points and persistent role switch.
- Student: class overview; pending, assigned, and attempted tests; test detail with ready/in-progress/submitted states; personal insight summary.
- Teacher: class and roster overview; invitation preview/state; quick test creation with topic, question count, difficulty, and collapsed More settings; assignment preview; attempted/not-attempted views; overall and individual insights.
- Query-selectable ready/loading/empty/error fixture states where useful.
- Local API mutations for invitation state, quick-test drafts, assignment recipients, and student attempt/result state.
- Adapter interfaces for future messaging and authoritative test-engine integration; demo adapters capture state locally and never send externally.
- Responsive behavior at phone, tablet, and desktop widths with accessible form controls and status labels.

## Safety boundary

No production authentication, email/WhatsApp send, migrations, Firebase, Firestore, GCP, deployment, or V3/V4 calls. Existing Vijeeta repositories stay read-only and untouched. Large content archives remain outside Git.

## Testing

Use test-first Vitest and Testing Library coverage for typed contracts, API validation, local persistence, role entry, student journey, teacher quick-create flow, and state variants. A smoke test exercises the complete session → invite → draft → assignment → attempt → results/insights flow through route handlers. Run lint, typecheck, tests, and production build before reporting completion.
