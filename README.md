# Vijeeta teacher–student dashboard prototype

An isolated, fixture-mode dashboard demo for Vijeeta. It includes a shared role entry, teacher and student experiences, and a local API whose state persists to a Git-ignored JSON file. It does **not** call Firebase, Firestore, GCP, production Vijeeta APIs, or external email/WhatsApp services.

## Run the demo

Requirements: Node.js 24.19.x and pnpm 11.19.x.

```sh
pnpm install --frozen-lockfile
pnpm --filter @vijeeta/dashboard-web dev
```

Open [http://localhost:3010](http://localhost:3010).

Choose either role on the landing screen. The role choice is remembered locally across reloads; the role switch in the header clears it and lets you move between the teacher and student journeys without signing in.

## Demo journeys

- **Teacher:** inspect classes and roster status, preview an email or WhatsApp invitation, create a quick test draft (including More settings), assign it to a class with direct-email exceptions, and review aggregate and individual insights.
- **Student:** inspect classes and assigned, pending, and attempted tests; start and submit a local attempt; view the released result and updated personal insights.
- **State:** successful actions flow from the browser through `POST /api/demo` and persist locally in `apps/dashboard-web/.local/dashboard-state.json`. The `.local` directory is excluded from Git.

All invitation and test-generation integrations use capture-only adapters. They record local intent but never send messages or call the existing Vijeeta test engine. Quick-test generation produces deterministic local practice questions so the full answer-and-submit journey works without an external service. The integration placeholders live in `apps/dashboard-web/src/server/store.ts`.

If the local state file is manually edited and becomes invalid, stop the server, remove `apps/dashboard-web/.local/dashboard-state.json`, and start the demo again. The fixture store will recreate a clean state; no tracked source file is affected.

## Verify

```sh
pnpm -r --workspace-concurrency=1 test
pnpm -r --workspace-concurrency=1 typecheck
pnpm -r --workspace-concurrency=1 lint
pnpm --filter @vijeeta/dashboard-web build
```

The API smoke test is `apps/dashboard-web/src/test/local-e2e-smoke.test.ts`. It exercises role reads, invitation and test-draft creation, assignment creation, a student attempt and submission, and teacher/student insight reads against an isolated temporary store.

## Isolation boundary

This repository was bootstrapped from the curated local V2 snapshot pinned at `7dbb47b`. The production Vijeeta checkout pinned at `989f2f3` was used only as a read-only behavior reference. Neither source checkout is modified or imported at runtime, and this repository's upstream push URL is disabled.
