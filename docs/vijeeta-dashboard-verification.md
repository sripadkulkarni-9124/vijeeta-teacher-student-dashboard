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
| Node | v24.19.0 (on-contract; pinned by `.node-version` and `.nvmrc`) |
| Java | Temurin 21.0.12.1, user-local at `~/.local/jdk` (emulator dependency only) |
| Auth emulator | `127.0.0.1:9099` |
| Firestore emulator | `127.0.0.1:8080` |
| Docker | Docker Desktop 29.7.2 |

## Monorepo checks

| Check | Result |
| --- | --- |
| `pnpm -r test` | 426 passed, 36 skipped |
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

Result: **32 passed / 32**.

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

## Cloud resources created 2026-08-28

Created by the project owner after the recorded approval, then verified read-only:

| Resource | State |
| --- | --- |
| `projects/neetcompanion-50b1f/databases/vijeeta-dashboard` | `asia-south1`, FIRESTORE_NATIVE, delete protection ENABLED, PITR ENABLED |
| `vijeeta-dashboard@neetcompanion-50b1f.iam.gserviceaccount.com` | created, enabled, keyless |
| IAM binding | `roles/datastore.user`, conditioned on `resource.name=="projects/neetcompanion-50b1f/databases/vijeeta-dashboard"` |

No Cloud Run service exists yet, and no rules or indexes have been deployed.

## Container image

Built from `apps/dashboard-web/Dockerfile` and run locally:

| Check | Result |
| --- | --- |
| image size | 423 MB |
| `/api/health` | `status: ok`, build reports the source SHA |
| runtime user | `uid=1001(nextjs)` — non-root |
| `/api/demo` | 404 — the fixture route is absent from the image |
| unauthenticated `/api/admin/profiles` | 401 |
| leaked `FIREBASE_AUTH_EMULATOR_HOST` | 503, refuses to serve |

The local image was built with a placeholder `NEXT_PUBLIC_FIREBASE_API_KEY` and
is tagged `localtest-<sha>` rather than the bare SHA, so it must not be pushed.
The release build supplies the real public key from the approved build
environment.

## Independent security review

An adversarial review covering identity and role authority, IDOR, invitation
crypto, Firestore isolation, redaction, the V3 boundary, and the browser code
reported one High and five Medium findings. Fixed and covered by tests:

- **High — authentication bypass.** A production runtime did not reject
  `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST`. firebase-admin
  silently switches to the emulator verifier, which skips JWT signature
  verification, so a forged unsigned token naming a bootstrap email would have
  become an Admin. The runtime now fails closed, verified in the container.
  The loopback check was also parsing hosts by splitting on `:`, which accepted
  `127.0.0.1:9099@attacker.example`; it now uses the URL parser.
- **Medium — four teacher actions were unreachable.** Archive, revoke, and
  redeliver sent no JSON body (rejected 415 before the reason was read) and
  assignment creation omitted the required idempotency key (400).
- **Medium — invitation acceptance was unreachable in the browser.** The token
  was captured from the link and discarded; nothing called inspect or accept.
- **Medium — missing Firestore indexes.** See below.
- **Medium — legacy profile backdoor.** A legacy-shaped profile document mapped
  an `allowedRoles` teacher entitlement straight to an active Teacher, skipping
  Admin approval. It now maps to `pending`.
- **Medium — cosmetic redaction defect** in `sanitizeError`: a non-capturing
  group makes the cookie replacement emit a literal `$1`. The secret is still
  removed, so this is not a leak. Not yet fixed.

Low-severity items not yet addressed: a classroom-existence oracle (404 vs 403,
mitigated by v4 UUID identifiers), client-supplied correlation IDs acting as
idempotency keys, and a backslash form missed by the client-side runner-path
check that no reachable server response can produce.

## Firestore indexes

Two composite queries had no declared index. Firestore answers
`FAILED_PRECONDITION`, which maps to a generic 503 that reports itself as
retryable but never resolves, so assignment creation and the Admin invitation
feed were dead against real Firestore. The emulator does not enforce index
requirements, so every local suite passed regardless.

| Query | Index | State |
| --- | --- | --- |
| assignment recipients | `members`, COLLECTION, `status ASC, studentUid ASC` | READY |
| Admin invitation feed | `invites`, COLLECTION_GROUP, `createdAt DESC, id DESC` | READY |

Both are created in `projects/neetcompanion-50b1f/databases/vijeeta-dashboard`
and the previously failing invitation query was re-run against it successfully.

Each query is built from its exported index constant, and the constants are
asserted against `firestore.indexes.dashboard.json`, so the two cannot drift.

The `collectionGroup(...).where("id", "==", ...)` lookups used by
`resolveAssignmentById` and `resolveInvitationById` need **no** declared index.
An earlier revision of this document claimed they required collection-group
field overrides; that was wrong, and both queries were verified to resolve
without one. The overrides were removed, because a field override replaces
automatic indexing for that field and would have narrowed it.

## Not covered — still open before deployment

1. **Cloud Run service.** Not created. The runtime identity exists but nothing
   runs as it yet.
2. **Rules and indexes are not deployed.** Both are written and tested locally.
   Deploying each is a separate approved cloud write.
3. **Real SMTP delivery.** Capture-only. `createSmtpInvitationEmailProvider`
   requires a transport factory and no mail library is a dependency of this
   repository, so production invitation delivery fails closed. Adding the
   library and supplying the approved relay credentials from Secret Manager are
   both still open.
4. **The V3 HTTP transport itself.** TLS, real upstream schemas, timeouts, and
   redirects are faked at the transport boundary by design.
5. **Registry vulnerability scanning** is disabled on the Artifact Registry
   repository, so images would ship unscanned.
6. **Remaining review findings.** The Medium redaction defect and the three Low
   findings above.

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
