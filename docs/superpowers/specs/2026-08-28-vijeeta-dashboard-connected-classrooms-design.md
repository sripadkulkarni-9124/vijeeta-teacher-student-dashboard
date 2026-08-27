# Vijeeta connected dashboard architecture

**Status:** Proposed for review; implementation and cloud writes remain paused

## 1. Outcome and release boundary

Ship a production-quality, isolated `vijeeta-dashboard` application with one Firebase sign-in/sign-up entry and server-authorized Student, Teacher, and Admin experiences. The dashboard owns profiles, role eligibility, classrooms, invitations, assignment metadata, and audit records in a new named Firestore database. Existing V3 remains authoritative for tests, runner, submission, grading, solution release, sharing, and analysis.

This design adds no route, collection, IAM permission, traffic change, or code change to the current Vijeeta application, `examprep-api`, the default/legacy Firestore database, Firebase Hosting, DNS, or `vijeeta.com`. The dashboard browser never talks directly to Firestore or V3. Cloud resource creation and deployment require a separate approved change after the local gate is green.

## 2. Components and authority

| Component | Owns | Must not own |
| --- | --- | --- |
| Dashboard browser | Firebase interactive sign-in, memory-only ID token, rendering, form intent | UID/role authority, Firestore access, V3 credentials, raw invite persistence |
| Dashboard BFF | Token verification, authorization, validation, DTO projection, orchestration, audit | V3 grading/test state, client-asserted identity, broad proxying |
| Named Firestore `vijeeta-dashboard` | Dashboard profiles, teacher eligibility, classes, invites, memberships, assignment snapshots, audit/reconciliation | Legacy V3 data or credentials |
| V3 adapter | Exact allowlisted calls with the caller's fresh Firebase Bearer token | Generic proxy, admin identity, retries of ambiguous writes |
| Existing V3 | Test creation, share, audience enforcement, runner, attempts, grades, results/analysis | Dashboard profiles, roles, classrooms, invitation delivery |
| Email adapter | One-purpose classroom invitation delivery | Membership authority, acceptance, password/auth messages |
| Approved SMTP relay | Transactional transport with authenticated TLS | Invite token validation, dashboard authorization |

All server routes derive the UID and verified email from a freshly verified Firebase ID token. Client-supplied UID, email, active role, ownership, or eligibility is never authoritative.

## 3. Identity, onboarding, and roles

### 3.1 Common sign-in

The browser uses Firebase Auth with in-memory persistence. It sends a fresh ID token as `Authorization: Bearer <token>` to same-origin dashboard APIs. Tokens are not written to local storage, cookies, logs, Firestore, email, or URLs.

On first authenticated request the BFF verifies `uid`, `email`, `email_verified`, and display name. A stable internal profile ID is generated separately from the canonical Firebase UID. A verified normalized email index is maintained transactionally for invitation matching. An unverified or absent email may create a limited profile but cannot receive classroom membership, become Teacher/Admin, invite, or be used as Reply-To.

### 3.2 Server-owned roles

- **Student:** may be explicitly selected during onboarding or explicitly added while accepting a matching invitation. Student can see only own memberships, assignments, launches, attempts, and insights.
- **Teacher:** a user may request Teacher during onboarding, but the role is pending until an Admin approves teacher eligibility. Approval is never implied by browser selection or V3 creator status. Suspension immediately blocks teacher mutations and privileged reads on the next request.
- **Admin:** cannot be self-selected. Initial Admin is granted only when the verified token matches an exact configured bootstrap UID or verified normalized email. After bootstrap, Admin authority is stored server-side. Bootstrap configuration never grants Admin to an unverified email.
- **Multi-role:** roles are explicit entries with independent status and provenance. Switching the active workspace does not grant a role. A Teacher accepting a student invitation must explicitly add Student.

V3 creator eligibility is separate from dashboard Teacher approval. A dashboard Teacher without V3 creator/owner capability may create and manage classrooms and invitations but cannot assign a V3 test they do not own; the UI explains this without escalating authority.

### 3.3 Admin least privilege

Admin may list and inspect dashboard profiles, approve/suspend Teacher eligibility, archive/restore dashboard-owned classes, revoke or request a fresh delivery for pending invitations, inspect invitation delivery state, and view immutable dashboard audit metadata. Admin has no default ability to read student answers, grades, individual insights, V3 bearer tokens, raw invite secrets, or SMTP credentials. A future answer/insight support role must be a separate explicit capability with a separately reviewed audit policy.

Admin actions require a reason, fresh authorization, server-side target resolution, and an append-only audit event. Admin cannot rewrite or delete audit history through product APIs.

## 4. Firestore schema and invariants

All paths are in `projects/neetcompanion-50b1f/databases/vijeeta-dashboard`. The service fails startup when configured with `default`, `(default)`, another project, or another database. There is no browser Firestore SDK and no client security-rules dependency.

### 4.1 Collections

- `profiles/{uid}`: internal profile ID, canonical UID, verified normalized email, display name, role states/provenance, active role, onboarding state, suspension state, schema version, timestamps.
- `profileEmailIndex/{sha256(normalizedEmail)}`: normalized email and UID. Created/updated only from an `email_verified=true` token in a transaction; collisions fail closed and create an audit alert.
- `classrooms/{classId}`: owner UID, name, status, timestamps. No class-delete API in this release.
- `classrooms/{classId}/members/{studentUid}`: accepted student membership, source invite ID, joined timestamp, membership status.
- `studentMemberships/{studentUid}/classes/{classId}`: server-maintained reverse projection for bounded student listing.
- `classrooms/{classId}/invites/{inviteId}`: owner UID, normalized target email, token hash/version, expiry, status, delivery state, accepted UID/time, timestamps. Raw tokens are never stored.
- `classrooms/{classId}/invites/{inviteId}/deliveryAttempts/{attemptId}`: provider, idempotency key, attempt/result timestamps, provider message ID, redacted error category. No message body or raw token.
- `classrooms/{classId}/assignments/{assignmentId}`: owner UID, V3 job/share/test identifiers, schedule/solution policy, immutable recipient snapshot, state, reconciliation metadata, timestamps.
- `auditEvents/{eventId}`: create-only query/read-model mirror containing actor UID/internal profile ID, action, target type/ID, reason/category, request correlation ID, redacted before/after summary, canonical log insert ID, and timestamp.

### 4.2 Security invariants

1. Every mutation runs in a server-authorized transaction or a documented state machine.
2. A classroom owner is a currently approved, unsuspended Teacher; ownership cannot be transferred in this release.
3. A Student membership is created only by a valid, unexpired invite presented by an authenticated user whose verified normalized Firebase email exactly matches the invite.
4. Invitation tokens are at least 256 bits of randomness; Firestore holds only an HMAC/SHA-256 digest with a server-managed pepper. Comparisons are constant-time.
5. Accepted membership and reverse projection are written atomically. Re-accept is idempotent for the same UID; a different UID fails.
6. Assignment recipients are the accepted, active classroom members at creation time and are immutable. Later joins receive only future assignments. Removal affects future assignments but does not erase historical V3 audience or insight provenance.
7. A teacher may fetch assignment insights only for an owned assignment and only for a UID in that assignment's immutable recipient snapshot.
8. No product API hard-deletes profiles, classrooms, invites, assignments, memberships, or audit events. State transitions and tombstones preserve evidence. The Firestore runtime role has no delete permission.
9. Firestore IAM cannot enforce collection-level create-only behavior because the same runtime needs entity updates elsewhere. `auditEvents` is therefore an application-enforced immutable mirror; the canonical tamper-resistant copy is a dedicated append-only Cloud Logging audit stream that the runtime can write but cannot update/delete/read through product APIs.

Required composite indexes are checked in before deployment and target only the named database: teacher class list, student membership list, invite status/expiry, assignment status/class time, and audit time/actor or target.

## 5. Invitation and email flow

1. Approved Teacher creates a classroom.
2. Teacher submits a student email. The server normalizes and validates it, creates a pending invite with a seven-day expiry and one-time token digest, then records `invite.created`.
3. The email adapter receives a one-purpose DTO: recipient email, teacher verified name/email, class name, expiry, and join URL. The join URL is `https://<dashboard-host>/invite#token=<inviteId>.<secret>` so the raw token does not enter HTTP access logs or referrers.
4. Local/test mode uses a capture-only adapter. It makes no network call and exposes captures only to the isolated test harness.
5. Production accepts only `smtp`, requires a validated public HTTPS dashboard URL, an approved relay host/port, authenticated TLS mode, username/password secret, exact sender, and invite-token pepper, and fails readiness closed when any is absent. Plaintext SMTP and opportunistic TLS are rejected.
6. The SMTP adapter sends from `ViJEEta <invites@vijeeta.com>`. `Reply-To` is the inviting teacher's verified email/name and the same identity appears in the body. A deterministic RFC Message-ID carries the delivery attempt ID. Because SMTP has no universal idempotency guarantee, an ambiguous post-DATA timeout is recorded as `unknown` and is never automatically retried.
7. Delivery failure leaves membership absent and exposes a redacted retryable/permanent state to the owner. Retry rotates the invite secret, invalidates the prior token, and creates a new delivery attempt. No automatic infinite retries.
8. The invitee signs in/signs up through Firebase. The browser takes the fragment token into memory, removes it from the visible URL, and submits it to the authenticated accept endpoint.
9. The server validates the digest, expiry, status, and exact verified-email match. If Student is absent, the user must explicitly add Student before acceptance. The transaction writes membership, reverse projection, acceptance, and audit event.

Invitation messages contain no student data beyond the target address, teacher identity, class name, expiry, and one-time link. No email open/click tracking is required. No WhatsApp, invite links through V3, passwordless login, or pending-email auto-claim is implemented.

### Existing V3 mail audit

Production V3 `POST /v3/paperdesk/jobs/{job_id}/share` validates and stores audience emails, registers the runner, mints a capability token, and returns a copy-ready `/t/{token}` link. Its service and API modules import no SMTP, Resend, SendGrid, Mailgun, Postmark, Twilio, WhatsApp, `requests`, or `httpx` delivery client. `docs/SHARED_TESTS_V5_PRD.md` explicitly lists “No mailer/WhatsApp notifications.” Therefore email delivery is not available through a supported V3 integration and the isolated dashboard SMTP adapter supplies notification transport.

## 6. Classroom assignment and V3 reuse

The generic production V3 BFF remains GET-only and restricted to its reviewed read paths. Connected assignment uses a separate, typed adapter with exact route templates and DTO projections.

### 6.1 Creation sequence

1. Approved Teacher selects an owned V3 final test from `GET /v3/paperdesk/jobs` and chooses an owned classroom, open/close window, and solution-release mode.
2. The BFF re-authorizes Teacher state and classroom ownership, reads accepted members, and writes assignment state `creating` with an immutable UID/email recipient snapshot.
3. The dedicated adapter sends exactly one `POST /v3/paperdesk/jobs/{jobId}/share` with recipient emails, window, and solution policy. It forwards the same fresh Firebase Bearer token; it never uses cookies, service credentials, API keys, admin headers, arbitrary paths, or arbitrary bodies.
4. On success the BFF strictly projects V3 `share.id`, `test_id`, runner link, and readout, then marks the assignment `active` and audits it.
5. A definite validated V3 rejection marks `failed`. A timeout, disconnect, malformed success, or other ambiguous outcome marks `reconciliation_required`. Because V3 has no idempotency key, the dashboard never automatically retries an ambiguous share and never creates a second share silently.
6. V3's current `GET /v3/paperdesk/shares` may lazily mint and persist missing legacy tokens, so the dashboard must not call it for automatic reconciliation, prefetching, or a read-only smoke. For an ambiguous share, the Teacher confirms the outcome in the existing authoritative V3 screen and supplies the resulting share ID; the BFF verifies ownership using the exact results route before linking it. Only a confirmed absence permits one explicit retry. Every decision is audited. A future pure, non-mutating upstream lookup would remove this manual step.

### 6.2 Student attempt sequence

The Student lists only own dashboard assignments. The BFF verifies membership/snapshot and, for an active assignment, returns a strictly validated V3 runner `web_path` on the pinned V3 origin. The Student opens the existing V3 `/t/{token}` runner. V3 continues to enforce verified audience email, time window, one attempt, grading, and solution release. The dashboard does not proxy answers, emulate the runner, or store submissions.

### 6.3 Insights sequence

- Student personal insights are refresh-based V3 reads scoped to the verified caller UID.
- Teacher aggregate insights call the exact V3 owner-only share-results route after dashboard assignment ownership is proven.
- Teacher individual insights additionally require the requested UID in the immutable recipient snapshot before calling the exact V3 individual-analysis route.
- Responses pass strict redacting DTO projections. Admin receives none of these results without a future explicit support capability.

Current V3 insight APIs are request/refresh based, not push realtime. The dashboard labels freshness, revalidates on focus/manual refresh and a bounded interval, and never claims live push.

## 7. Dashboard API contract

All routes require a valid Firebase Bearer token except `/api/health`. JSON bodies are size-bounded and schema-validated; unknown keys are rejected. Mutations accept an idempotency key/correlation ID where meaningful. Errors use a stable code, safe message, correlation ID, and retryability—never raw upstream bodies or tokens.

| Method and route | Authority | Purpose |
| --- | --- | --- |
| `GET /api/profile` | authenticated | Resolve server profile/role states |
| `POST /api/profile/onboard` | authenticated | Explicit Student or Teacher request; Teacher remains pending |
| `POST /api/profile/active-role` | allowed role | Switch presentation workspace only |
| `GET /api/admin/profiles` | Admin | Bounded/redacted dashboard profile list |
| `POST /api/admin/teachers/{uid}/approve` | Admin | Approve Teacher with reason |
| `POST /api/admin/teachers/{uid}/suspend` | Admin | Suspend Teacher with reason |
| `GET /api/admin/classrooms` | Admin | Inspect dashboard class metadata only |
| `GET /api/admin/invitations` | Admin | Inspect redacted status/delivery metadata |
| `POST /api/admin/classrooms/{id}/archive` | Admin | Archive class with reason; no deletion or V3 revocation |
| `POST /api/admin/classrooms/{id}/restore` | Admin | Restore class with reason |
| `POST /api/admin/invitations/{id}/revoke` | Admin | Revoke pending invite with reason |
| `POST /api/admin/invitations/{id}/redeliver` | Admin | Rotate token and request one fresh delivery with reason |
| `GET /api/admin/audit` | Admin | Read append-only audit events |
| `GET/POST /api/classes` | Student/Teacher | Own memberships list / create owned class |
| `GET /api/classes/{id}` | member/owner | Scoped class detail |
| `GET/POST /api/classes/{id}/members` | owner | List / invite by email; POST initiates invite delivery |
| `POST /api/invitations/inspect` | authenticated | Inspect redacted invite/class/expiry after token validation |
| `POST /api/invitations/accept` | explicit Student | Accept exact verified-email invitation |
| `POST /api/classes/{id}/assignments` | approved owner + V3 owner | Snapshot recipients and create V3 share |
| `GET /api/classes/{id}/assignments` | member/owner | Scoped assignment list |
| `GET /api/assignments/{id}/launch` | snapshotted Student | Return validated V3 runner path |
| `GET /api/assignments/{id}/insights` | owner or snapshotted Student | Authorized aggregate/self projection |
| `GET /api/assignments/{id}/students/{uid}/insights` | owner | Authorized individual projection |
| `POST /api/assignments/{id}/reconcile` | owner with explicit state | Audited ambiguity resolution; no blind retry |

Collection-management responses never expose normalized-email index keys, token digests, provider error payloads, audit internals, or another teacher's data. Pagination and upper bounds apply to every list.

## 8. UI routes and states

The authoritative visual reference is the supplied Stitch **Academic Precision** package at `/Users/sripad/Downloads/stitch_vijeeta_learning_platform_dashboard`. Its `DESIGN.md`, HTML, desktop screens, and mobile screens define the visual system; embedded mock data and unsupported controls do not define product authority or API behavior. In particular, the reference's password fields, role switch labels, test-generation control, shareable-link copy, message/release-result buttons, and in-dashboard answer runner are adapted, disabled, or omitted wherever they conflict with Firebase-only sign-in, server-owned roles, the scoped release, or the authoritative V3 runner.

The implementation uses the reference's Inter type scale, primary indigo `#3525cd`/`#4f46e5`, neutral surface `#f7f9fb`, mint success, amber warning, low-contrast outlines, white 16px-radius cards, and low/no elevation. Spacing follows a 4px rhythm with 24px card gaps. Layouts use 12 columns at desktop, 8 at tablet, and 4 at mobile with fixed bottom navigation on mobile and persistent side navigation on desktop. Data-heavy views preserve horizontal dividers, compact labels, clear status pills, and content-first hierarchy.

- `/`: common Firebase sign-in/sign-up and role-aware redirect.
- `/onboarding`: explicit Student selection or Teacher request; Admin is absent.
- `/pending-teacher` and `/suspended`: clear non-privileged states.
- `/student`: own classes, assigned/pending/attempted tests, launch state, personal insights, refresh timestamp.
- `/teacher`: owned classes, invitation delivery state, assignable V3 tests, schedule/assignment status, attempted/not-attempted, aggregate/individual insights.
- `/invite`: signed-in invitation inspect, explicit Student addition if needed, accept/join result.
- `/admin`: profile search, Teacher approval/suspension with reason, class archive/restore, invitation revoke/redeliver, redacted inspection, and audit feed.

Every route rechecks the server profile; URL selection is not authority. Loading, empty, invalid/expired invite, unverified email, delivery failure, pending/suspended Teacher, V3 capability absent, V3 unavailable, assignment reconciliation, no attempts, and partial insight states are explicit and accessible. Destructive-looking actions require confirmation and describe their actual limited semantics.

The supplied screen mapping is:

- `sign_in_role_selection`: common Firebase sign-in and separate first-use role onboarding, without email/password authentication.
- `teacher_dashboard` and `teacher_dashboard_mobile`: responsive Teacher overview and navigation.
- `classrooms_roster`: owned classroom, accepted students, pending/delivery-failed invitations, and invite form; no shareable-link feature.
- `test_creation_wizard`: retained as a visual pattern for selecting an existing V3 test and schedule; this release does not generate a new test.
- `assignment_results_insights`: attempted/not-attempted aggregate and authorized individual insight drawer; message/release actions are absent.
- `student_dashboard` and `student_dashboard_mobile`: class-linked assignments, attempt state, and V3 launch.
- `student_personal_insights`: refresh-based personal V3 insights.
- `test_attempt_interface`: visual reference only for the launch handoff; the actual attempt remains the existing V3 runner.
- Admin console: derives the same Academic Precision shell, table, status-pill, dialog, and responsive patterns because no supplied Admin screen exists.

## 9. Configuration, secrets, and IAM proposal

### 9.1 Runtime configuration

- Existing pinned values: `VIJEETA_RUNTIME_MODE=production`, `VIJEETA_FIREBASE_PROJECT_ID=neetcompanion-50b1f`, `VIJEETA_FIRESTORE_DATABASE_ID=vijeeta-dashboard`, `VIJEETA_V3_BASE_URL=<exact approved examprep origin>`, `VIJEETA_BUILD_ID=<full SHA>`.
- Public Firebase web configuration remains browser-visible and pinned; it is not an admin credential.
- New non-secret values: `VIJEETA_DASHBOARD_PUBLIC_URL=<canonical Cloud Run HTTPS URL>`, `VIJEETA_INVITE_EMAIL_PROVIDER=smtp`, `VIJEETA_INVITE_FROM=ViJEEta <invites@vijeeta.com>`, `VIJEETA_SMTP_HOST=<approved relay>`, `VIJEETA_SMTP_PORT=<approved TLS port>`, `VIJEETA_SMTP_TLS_MODE=implicit_tls|starttls_required`, invite expiry/refresh limits within reviewed bounds.
- Secret Manager: `vijeeta-dashboard-smtp-credentials` containing versioned username/password JSON, `vijeeta-dashboard-invite-token-pepper`, and `vijeeta-dashboard-admin-bootstrap` containing a versioned JSON allowlist of exact UID(s) and/or normalized verified email(s). No secret value appears in source, chat, build args, image layers, logs, or browser code.

The bootstrap secret is consumed only by the dashboard server. A matching verified identity creates the initial Admin role once and emits an audit event; changing the secret does not silently revoke persisted Admins. Subsequent Admin grants are not part of this release unless a separately reviewed two-person flow is added.

### 9.2 Least privilege

- Runtime service account: `vijeeta-dashboard@neetcompanion-50b1f.iam.gserviceaccount.com`, keyless.
- Database access: a project custom role containing only `datastore.databases.get`, `datastore.databases.getMetadata`, `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`, and `datastore.entities.update`, conditioned on exactly `projects/neetcompanion-50b1f/databases/vijeeta-dashboard`. Runtime delete is intentionally impossible.
- Secret access: `roles/secretmanager.secretAccessor` granted separately on the three exact secret resources only.
- Audit access: `roles/logging.logWriter` only. A dedicated sink routes only the `vijeeta_dashboard_audit` log from the new service into a dedicated retention-controlled log bucket. The runtime receives no log-viewer, config-writer, bucket-writer, or delete permission. Firestore mirrors support the Admin UI without broad project-log access.
- Deployer gets `iam.serviceAccountUser` on this runtime account only.
- No Firebase Admin key, project Editor/Owner, default-database access, broad Secret Manager access, service-account key, legacy runtime identity, or browser credentials.

Required user/provider actions before email can be enabled: select an approved SMTP relay (no Gmail or third-party account is assumed), obtain its relay host/port/TLS requirement and restricted username/password, authorize `invites@vijeeta.com`, publish/verify SPF and DKIM (and DMARC alignment where applicable), store credentials in Secret Manager, and supply one existing verified Firebase UID or email for Admin bootstrap.

## 10. Observability, audit, and reconciliation

- `/api/health` reports build, mode, dependency readiness, and safe reason codes without probing V3 with writes or exposing config values.
- Structured logs include correlation ID, route template, actor internal profile ID, authorization decision category, latency, dependency, status, and assignment/invite IDs. They exclude Bearer tokens, invite secrets/digests, full emails, request bodies, V3 raw responses, SMTP credentials/server responses, and student answers.
- Metrics: auth failures, authorization denials, invite delivery outcomes, acceptance outcomes, V3 read/write latency and errors, assignments by state, reconciliation age, insight freshness/errors, Firestore contention, and audit-write failures.
- Security/audit mutations fail closed if the required Firestore audit mirror cannot be committed atomically. The corresponding canonical structured audit entry uses the same event ID as its log insert ID. External-call events record durable intent before the call and outcome afterward because Firestore and V3/SMTP/Cloud Logging cannot share a transaction; a reconciliation metric alerts on a missing canonical/mirror counterpart.
- Operators get a bounded reconciliation view for stuck delivery and V3 assignment states. No background worker blindly repeats non-idempotent V3 share writes.

## 11. Deployment, canary, and rollback

After local tests, independent review, and explicit cloud approval:

1. Create the named Firestore database with delete protection/PITR, required indexes/backups, then the database-scoped no-delete runtime IAM.
2. Create the three secrets and exact per-secret access bindings; never print values.
3. Create the dedicated audit log bucket/sink and approved retention; lock retention only as its own explicit irreversible approval. Grant the runtime log-writer only.
4. Build one immutable image tagged with the full Git SHA.
5. Deploy only new service `vijeeta-dashboard` in `asia-south1` with its dedicated identity and direct Cloud Run URL, initially as a tagged no-traffic candidate when supported.
6. Add only the canonical service hostname to Firebase Authorized Domains after it exists. Do not change Hosting, DNS, or existing domains.
7. Smoke health, sign-in, profile/onboarding, Admin bootstrap/approval, classroom/invite with a controlled mailbox, acceptance, one controlled V3 classroom share, runner launch, and read-only insights. Never submit a real student's answers in a smoke test.
8. Move only the new service to 100% after evidence review.

Application rollback routes only this new service to its previous known-good immutable revision. It does not roll back Firestore writes; data incidents use an audited forward fix or restore into another isolated named database after approval. Email can be disabled fail-closed without disabling sign-in/read-only views. Ambiguous V3 shares remain in reconciliation and are never replayed by rollback.

## 12. Verification gate

Implementation is test-driven and must pass unit, route-contract, store-transaction, adapter, UI, integration, smoke, lint, typecheck, production build, container, and independent security review gates. Required adversarial cases include forged role/UID/email, unverified or changed email, bootstrap spoofing, suspended Teacher, cross-owner class access, token guessing/replay/expiry/rotation, mismatched invitee, concurrent acceptance, duplicate reverse projections, audit failure, SMTP authentication/TLS/timeout/ambiguous-delivery behavior, recipient snapshot races, V3 ownership denial, ambiguous V3 share outcome, cross-assignment insight access, raw data leakage, default-database configuration, and secret/token log redaction.

Visual verification renders deterministic states at representative desktop (1440×900), tablet (1024×768), and mobile (390×844) viewports. Manual screenshot comparison covers every supplied desktop/mobile reference and the added Admin/invitation states, checking hierarchy, grid spans, spacing rhythm, typography, color roles, card elevation, overflow, sticky/fixed navigation, keyboard focus, zoom, and reduced motion. Reference screenshots are design comparators, not pixel-perfect assertions for intentionally changed security/product behavior.

A mandatory pre-cloud role gate starts the built production-mode service locally with explicitly guarded loopback-only emulator/test dependencies. The gate is accepted only when Cloud Run markers are absent, every dependency host is loopback, SMTP is capture-only, the bootstrap identity is synthetic, and no production V3/Firebase/Firestore/SMTP endpoint is reachable. It exercises Admin bootstrap and Teacher lifecycle/class/invite management, Teacher classroom/assignment/results flows, Student signup/invite acceptance/membership/V3-runner handoff/own insights, and cross-role denial. Exact passed and blocked flows plus terminal/build evidence are recorded and reported to the user before any cloud write.

Cloud deployment remains blocked until every gate is green, the local production-mode three-role gate has passed and been reported to the user, and the exact cloud-write plan is re-approved with the Admin bootstrap identity, approved SMTP relay credentials, and verified sender-domain state.

## 13. Explicit limitations and future evolution

- No WhatsApp, SMS, bulk marketing, invite forwarding, magic login, pending-email auto-claim, class deletion, ownership transfer, organisation tenancy, or direct messaging.
- No dashboard test creation, answer submission, grading, solution engine, or replacement runner.
- No push realtime; refresh/revalidation is explicit.
- No Admin student-answer/insight access by default.
- No automatic retry of ambiguous V3 shares.
- Removing a member cannot revoke a historical V3 share for that one recipient; the UI states this and future assignments exclude them.
- Future work may add organisations, delegated Admins with two-person approval, invitation queues/webhooks, revocation-aware V3 APIs, idempotent V3 share creation, push notifications, and dedicated support capabilities without weakening the boundaries above.
