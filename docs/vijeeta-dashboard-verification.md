# Vijeeta dashboard verification evidence

Status: **local verification only. No cloud resource has been created, changed, or deployed.**

This records what the pre-cloud gate proves and, just as importantly, what it does
not. A green gate here is not deployment approval; the approval gates in
[deploy-vijeeta-dashboard.md](deploy-vijeeta-dashboard.md) are unchanged and unsigned.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-08-28 |
| Branch | `feat/connected-dashboard` |
| Node | v22.22.2 (**off-contract**; `engines` requires `>=24.19.0 <25`) |
| Java | Temurin 21.0.12.1, user-local at `~/.local/jdk` (emulator dependency only) |
| Auth emulator | `127.0.0.1:9099` |
| Firestore emulator | `127.0.0.1:8080` |
| Docker | unavailable (daemon not running) |

## Monorepo checks

| Check | Result |
| --- | --- |
| `pnpm -r test` | 413 passed, 14 skipped, 53 files |
| `pnpm -r typecheck` | clean |
| `pnpm -r lint` | clean, `--max-warnings=0` |
| `pnpm --filter @vijeeta/dashboard-web build` | clean, 27 API routes + 9 pages |

The 14 skipped tests are the release gate itself, which skips unless the
emulators are running so that ordinary `pnpm test` stays hermetic.

## Three-role release gate

Run with:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm --filter @vijeeta/dashboard-web exec vitest run src/test/connected-e2e-smoke.test.ts
```

Result: **14 passed / 14**.

The gate drives the real route handlers, the real `FirestoreDashboardStore`, the
real `FirestoreProfileStore`, the real `FirebaseIdTokenVerifier`, and the real
`CaptureInvitationEmailProvider`. Identities are real Firebase accounts with
verified email, and every request carries a real ID token.

| # | Flow | Result |
| --- | --- | --- |
| 1 | Unauthenticated profile read is rejected | PASS (401) |
| 2 | Configured Admin identity bootstraps to an active Admin | PASS |
| 3 | Non-configured identity does **not** bootstrap | PASS (404) |
| 4 | Teacher onboards as pending and is denied class creation | PASS (403) |
| 5 | Admin lists profiles and approves the Teacher | PASS |
| 6 | Teacher is refused Admin profile listing | PASS (403) |
| 7 | Approved Teacher creates a class, owned by that Teacher | PASS (201) |
| 8 | Teacher invites a student; delivery is captured, no SMTP socket | PASS |
| 9 | Non-owning Teacher is refused the roster | PASS (403/404) |
| 10 | Roster shows the pending invitation with a masked email | PASS |
| 11 | Invitation addressed to another email is refused | PASS (403/404) |
| 12 | Invited Student accepts and joins the class | PASS (200) |
| 13 | Roster shows the Student as a member, invitation accepted | PASS |
| 14 | Student sees only the joined class; an outsider sees none | PASS |

The invitation email is captured, never sent: the recipient, teacher email, and
tokenised URL are asserted from the capture, and no SMTP connection is opened.

## Safety properties of the gate

The gate cannot silently run against production. `isReleaseGateMode` in
[runtime-config.ts](../apps/dashboard-web/src/server/runtime-config.ts) fails
closed unless the explicit opt-in is set, no Cloud Run marker (`K_SERVICE`,
`K_REVISION`, `K_CONFIGURATION`) is present, and both emulator hosts are
loopback. This matters because Application Default Credentials **are** present on
this machine, so an unguarded run could otherwise have reached the real
`neetcompanion-50b1f`.

The gate relaxes no production rule. The approved V3 origin stays pinned, and V3
is reached through an in-process fake transport, so the gate performs no network
egress at all. Six unit tests cover the guard, including refusal on Cloud Run, on
a non-loopback emulator host, on a missing emulator host, and on a non-approved
V3 origin while the gate is on.

## Firestore security rules

The reviewed rule set for the named database is
[firestore.dashboard.rules](../firestore.dashboard.rules). It is deny-all at
`match /{document=**}`, for every credential, authenticated or not.

That is the whole rule set on purpose. The server reaches Firestore through the
Firebase Admin SDK, which bypasses security rules entirely, so these rules
constrain nothing the application does; authorization lives in the route
handlers and the store. The browser ships no Firestore SDK and holds no
Firestore credential. The rules are a backstop for the case where a client
credential is nonetheless pointed at this database, and any future client access
requires a separate security review.

`apps/dashboard-web/src/test/firestore-rules.test.ts` loads that file into a
Firestore emulator with `@firebase/rules-unit-testing` and asserts denial for
three client contexts — unauthenticated, authenticated, and authenticated with
an admin-looking token carrying `email_verified`, `role: "admin"`, and
`admin: true`. It covers every document path the store writes (`profiles`,
`profileEmailIndex`, `classrooms` and its `members`, `invites`,
`deliveryAttempts`, `assignments`, `outboundOperations`, `inviteRateLimits`
subcollections, `studentMemberships`, `studentAssignments`, `mutationKeys`,
`auditEvents`) plus a path the store never uses, and asserts denial of reads,
writes, deletes, collection queries, and collection-group queries. Documents are
seeded through the rules-disabled context first, so a denial is a real refusal
rather than a missing document, and a final assertion confirms the seeded
documents were not modified.

Run it against an emulator of your own, never a shared one:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8280 pnpm --filter @vijeeta/dashboard-web exec vitest run src/test/firestore-rules.test.ts
```

Result: **4 passed / 4**. It skips when `FIRESTORE_EMULATOR_HOST` is unset, so
ordinary `pnpm test` stays hermetic. The test was also negative-controlled:
temporarily changing the rule to `allow read, write: if true` makes three of the
four assertions fail with "Expected request to fail, but it succeeded", so the
pass is not vacuous.

What this does not prove: the rules have never been deployed, `firebase deploy`
was not run, and no cloud resource was touched. The named database still does
not exist, so nothing is currently enforcing them.

## Not covered — still open before deployment

1. **Cloud Run runtime identity and IAM.** The dedicated service account and the
   per-database conditional binding are unapproved and uncreated.
2. **Firestore security rules.** Written and tested locally; see
   [Firestore security rules](#firestore-security-rules) below. Not deployed,
   and the deployment step is unapproved.
3. **Real SMTP delivery.** Capture-only here. The approved SMTP host and
   credentials must come from Secret Manager, not source.
4. **V3 assignment, launch, and insight adapters.** The store-side flows are
   covered; the adapters are exercised by unit tests but not by this integrated
   gate, because the transport requires `https:` on port 443 and is faked here.
5. **Named Firestore database.** `projects/neetcompanion-50b1f/databases/vijeeta-dashboard`
   does not exist. Read-only preflight on 2026-08-28 returned `NOT_FOUND`, which
   is expected evidence, not permission to create it.
6. **Node version.** Local Node is v22.22.2; the image and `engines` require 24.
7. **Container image.** Docker is unavailable locally, so the immutable image has
   never been built or run.
8. **Independent security and code review.** Not yet performed.

## Preflight evidence recorded 2026-08-28

Read-only, no cloud writes.

| Check | Result |
| --- | --- |
| Firestore database `vijeeta-dashboard` | `NOT_FOUND` (expected) |
| Firestore location `asia-south1` | supported |
| Artifact Registry `cloud-run-source-deploy` | exists, asia-south1, DOCKER |
| Cloud Run services in asia-south1 | 79; no `vijeeta-dashboard` |
| `examprep-api` URL | `https://examprep-api-4q2t5b27aa-el.a.run.app` — exact match to the pinned approved V3 origin |

Registry vulnerability scanning is disabled (`containerscanning.googleapis.com`
not enabled), so images would ship unscanned. That is a decision to record, not a
blocker.
