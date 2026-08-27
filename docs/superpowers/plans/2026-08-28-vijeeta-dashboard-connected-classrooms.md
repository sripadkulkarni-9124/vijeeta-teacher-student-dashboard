# Vijeeta Connected Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the isolated production dashboard's Firebase onboarding, bootstrap Admin, Teacher approval, classrooms, email invitations, V3-backed assignment/attempt/insight flow, and Academic Precision UI without changing an existing Vijeeta service.

**Architecture:** The Next.js dashboard is a same-origin BFF. It verifies Firebase ID tokens, resolves all roles and object authority from the named `vijeeta-dashboard` Firestore database, and calls only exact typed V3 routes with the caller's fresh Bearer token. Dashboard-owned writes use explicit state machines, create-only audit mirrors, a canonical structured audit stream, capture/Resend email adapters, immutable assignment-recipient snapshots, and fail-closed production configuration.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Zod contracts, Firebase Auth/Admin, named Firestore, Vitest/Testing Library, Cloud Run, Secret Manager, Resend.

**Spec:** `docs/superpowers/specs/2026-08-28-vijeeta-dashboard-connected-classrooms-design.md`

## Global Constraints

- Modify only `/Users/sripad/Desktop/Vijeetha apsir`; production and curated Vijeeta sources remain read-only.
- No cloud write, deployment, Firebase change, DNS/Hosting change, V3 source change, or external email send until the complete local gate and explicit cloud approval.
- Production identity is a verified Firebase token; never accept client UID, email, role, ownership, or Admin status as authority.
- Admin bootstrap is an exact server-side Secret Manager allowlist match. The initial normalized email is `sripadkulkarni@vedantu.com`, but it must not be compiled into application code or used before `email_verified=true` sign-in.
- Firestore project/database are pinned to `neetcompanion-50b1f` / `vijeeta-dashboard`; reject `default`, `(default)`, fixture, and local persistence in production.
- V3 origin is pinned; generic V3 BFF remains GET-only. V3 share is a separate exact POST adapter with no automatic retry after an ambiguous outcome.
- Existing V3 runner, submission, grading, solution release, and analysis remain authoritative.
- Production email provider is Resend; local/CI provider is capture-only. No secret or raw invite token enters source, logs, URLs sent to the server, or browser persistence.
- Academic Precision Stitch assets are the visual source of truth; mock-only password, share-link, test-generation, messaging, release, and embedded-runner behavior is not copied.
- Every slice uses TDD, a focused verification command, `git diff --check`, and a small commit.
- Preserve unrelated untracked files in `apps/dashboard-web/dev-fixture`.

---

## File Structure

### Shared contracts

- `packages/api-contracts/src/connected-dashboard.ts`: production identity, role, classroom, invite, assignment, insight, audit, and error schemas.
- `packages/api-contracts/src/connected-dashboard.test.ts`: strict parsing/projection and invalid-transition fixtures.
- `packages/api-contracts/src/index.ts`: export the new contract module.

### Server domain and persistence

- `apps/dashboard-web/src/server/principal.ts`: verified Firebase principal shape and normalization.
- `apps/dashboard-web/src/server/authorization.ts`: role/account/object authorization predicates.
- `apps/dashboard-web/src/server/dashboard-store.ts`: focused store interfaces and domain errors.
- `apps/dashboard-web/src/server/firestore-dashboard-store.ts`: named-Firestore transactions and query projections.
- `apps/dashboard-web/src/server/admin-bootstrap.ts`: parse/match versioned bootstrap allowlist.
- `apps/dashboard-web/src/server/invite-token.ts`: generate, digest, parse, and constant-time verify invite tokens.
- `apps/dashboard-web/src/server/email-provider.ts`: provider interface and capture implementation.
- `apps/dashboard-web/src/server/resend-email-provider.ts`: fail-closed Resend adapter.
- `apps/dashboard-web/src/server/v3-assignment-adapter.ts`: exact share POST and strict projection.
- `apps/dashboard-web/src/server/v3-insight-adapter.ts`: exact owner/student insight reads and projections.
- `apps/dashboard-web/src/server/audit.ts`: structured canonical audit emitter and redaction.
- `apps/dashboard-web/src/server/runtime-config.ts`: pin new provider/public URL/bootstrap/audit settings.

### Server routes

- `apps/dashboard-web/src/app/api/profile/*`: profile resolution, onboarding, active-role selection.
- `apps/dashboard-web/src/app/api/admin/*`: Teacher lifecycle, class/invite management, audit reads.
- `apps/dashboard-web/src/app/api/classes/*`: class, roster/invite, and assignment APIs.
- `apps/dashboard-web/src/app/api/invitations/*`: authenticated inspect/accept.
- `apps/dashboard-web/src/app/api/assignments/*`: launch, insight, and reconciliation APIs.

Each route has a colocated `route.test.ts`; shared route parsing lives in `apps/dashboard-web/src/server/http.ts`.

### Browser UI

- `apps/dashboard-web/src/client/connected-api.ts`: typed same-origin client with memory-only Bearer injection.
- `apps/dashboard-web/src/components/academic-shell.tsx`: desktop sidebar/header and mobile navigation.
- `apps/dashboard-web/src/components/auth-entry.tsx`: Firebase entry/onboarding/pending/suspended states.
- `apps/dashboard-web/src/features/admin/admin-dashboard.tsx`: Admin management/audit UI.
- `apps/dashboard-web/src/features/teacher/connected-teacher-dashboard.tsx`: class, invitation, assignment, result flows.
- `apps/dashboard-web/src/features/student/connected-student-dashboard.tsx`: classes, assignments, V3 launch, insights.
- `apps/dashboard-web/src/app/globals.css`: Academic Precision design tokens/layout utilities.
- `apps/dashboard-web/src/app/*`: protected routes for onboarding, invite, Admin, Teacher, and Student.

### Operations and verification

- `.github/workflows/dashboard-ci.yml`: unprivileged PR/push install, test, lint, typecheck, and build gate with no GCP credentials.
- `cloudbuild.dashboard.yaml`: immutable image build recipe.
- `cloudbuild.dashboard-release.yaml`: approval-gated main-SHA build/test/deploy recipe scoped to the new service only.
- `firestore.indexes.dashboard.json`: named-database index definitions.
- `docs/vijeeta-dashboard-api.md`: API authority and DTO handoff.
- `docs/vijeeta-dashboard-operations.md`: observability/audit/reconciliation procedures.
- `docs/deploy-vijeeta-dashboard.md`: exact secrets/IAM/canary/rollback proposal.
- `apps/dashboard-web/src/test/connected-e2e-smoke.test.ts`: full local capture-mode flow.
- `apps/dashboard-web/src/test/security-boundaries.test.ts`: cross-role/object and redaction attacks.
- `apps/dashboard-web/src/test/visual-reference.test.tsx`: deterministic responsive landmarks.

---

### Task 1: Production contracts and state machines

**Files:**
- Create: `packages/api-contracts/src/connected-dashboard.ts`
- Create: `packages/api-contracts/src/connected-dashboard.test.ts`
- Modify: `packages/api-contracts/src/index.ts`

**Interfaces:**
- Produces: `VerifiedPrincipalSchema`, `DashboardProfileV2Schema`, `AdminBootstrapConfigSchema`, `ClassroomSchema`, `ClassroomInviteSchema`, `ClassroomMembershipSchema`, `ClassroomAssignmentSchema`, `AuditEventSchema`, route request/response schemas, and `ApiErrorSchema`.
- Role states: Student `active|suspended`; Teacher `pending|active|suspended|rejected`; Admin `active|suspended`.
- Assignment states: `creating|active|failed|reconciliation_required|archived`.

- [ ] **Step 1: Write strict schema tests**

```ts
expect(() => DashboardProfileV2Schema.parse({ firebaseUid: "u", roles: { admin: "active" } })).toThrow();
expect(AdminBootstrapConfigSchema.parse({
  version: 1,
  verifiedEmails: ["admin@example.com"],
  firebaseUids: [],
}).verifiedEmails).toEqual(["admin@example.com"]);
expect(() => ClassroomAssignmentSchema.parse({ state: "active", recipientSnapshot: [] })).toThrow();
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/api-contracts test -- connected-dashboard.test.ts`
Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement the schemas with `.strict()` objects, bounded strings/lists, ISO timestamps, normalized email refinement, and discriminated states**

```ts
export const TeacherStateSchema = z.enum(["pending", "active", "suspended", "rejected"]);
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string().max(64), message: z.string().max(240), correlationId: z.string().uuid(), retryable: z.boolean() }).strict(),
}).strict();
```

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @vijeeta/api-contracts test -- connected-dashboard.test.ts && pnpm --filter @vijeeta/api-contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-contracts/src/connected-dashboard.ts packages/api-contracts/src/connected-dashboard.test.ts packages/api-contracts/src/index.ts
git commit -m "feat: define connected dashboard contracts"
```

### Task 2: Verified principal and bootstrap-only Admin

**Files:**
- Create: `apps/dashboard-web/src/server/principal.ts`
- Create: `apps/dashboard-web/src/server/principal.test.ts`
- Create: `apps/dashboard-web/src/server/admin-bootstrap.ts`
- Create: `apps/dashboard-web/src/server/admin-bootstrap.test.ts`
- Modify: `apps/dashboard-web/src/server/firebase-runtime.ts`
- Modify: `apps/dashboard-web/src/server/firebase-runtime.test.ts`
- Modify: `apps/dashboard-web/src/server/runtime-config.ts`
- Modify: `apps/dashboard-web/src/server/runtime-config.test.ts`

**Interfaces:**
- Produces: `VerifiedPrincipal { uid; email: string|null; emailVerified: boolean; displayName: string|null; authTime: string }`.
- Produces: `parseAdminBootstrap(secretJson): AdminBootstrapConfig` and `matchesAdminBootstrap(principal, config): boolean`.
- Production config consumes `VIJEETA_ADMIN_BOOTSTRAP_JSON` from a Secret Manager-mounted env value; local tests use synthetic identities only.

- [ ] **Step 1: Write failing authority/config tests**

```ts
expect(matchesAdminBootstrap(
  { uid: "u1", email: " ADMIN@EXAMPLE.COM ", emailVerified: true, displayName: null, authTime: now },
  { version: 1, verifiedEmails: ["admin@example.com"], firebaseUids: [] },
)).toBe(true);
expect(matchesAdminBootstrap({ ...principal, emailVerified: false }, config)).toBe(false);
expect(() => loadRuntimeConfig({ NODE_ENV: "production", VIJEETA_ADMIN_BOOTSTRAP_JSON: "" })).toThrow(/bootstrap/);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/principal.test.ts src/server/admin-bootstrap.test.ts src/server/firebase-runtime.test.ts src/server/runtime-config.test.ts`
Expected: FAIL on missing principal/bootstrap behavior.

- [ ] **Step 3: Extend Firebase verification and add exact bootstrap matching**

```ts
const decoded = await auth.verifyIdToken(token, true);
return VerifiedPrincipalSchema.parse({
  uid: decoded.uid,
  email: decoded.email ?? null,
  emailVerified: decoded.email_verified === true,
  displayName: decoded.name ?? null,
  authTime: new Date(decoded.auth_time * 1000).toISOString(),
});
```

Reject duplicate/case-variant config entries, invalid emails/UIDs, unknown keys, unverified email matches, and Firebase project mismatch. Never log the secret JSON.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/principal.test.ts src/server/admin-bootstrap.test.ts src/server/firebase-runtime.test.ts src/server/runtime-config.test.ts && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/server/{principal,principal.test,admin-bootstrap,admin-bootstrap.test,firebase-runtime,firebase-runtime.test,runtime-config,runtime-config.test}.ts
git commit -m "feat: enforce verified admin bootstrap identity"
```

### Task 3: Store interfaces, Firestore schema, and immutable audit mirror

**Files:**
- Create: `apps/dashboard-web/src/server/dashboard-store.ts`
- Create: `apps/dashboard-web/src/server/firestore-dashboard-store.ts`
- Create: `apps/dashboard-web/src/server/firestore-dashboard-store.test.ts`
- Create: `apps/dashboard-web/src/server/audit.ts`
- Create: `apps/dashboard-web/src/server/audit.test.ts`
- Create: `firestore.indexes.dashboard.json`

**Interfaces:**
- Produces: `ProfileRepository`, `AdminRepository`, `ClassroomRepository`, `InvitationRepository`, `AssignmentRepository`, and `AuditRepository` focused interfaces.
- Every mutation accepts `{ principal; now; correlationId; reason? }` and creates `auditEvents/{eventId}` in the same Firestore transaction.
- `bootstrapAdmin(principal, config)` is idempotent for the same verified identity and creates exactly one `admin.bootstrap` event.

- [ ] **Step 1: Write transaction and hostile-identity tests**

```ts
await expect(store.bootstrapAdmin(unverifiedPrincipal, config)).rejects.toMatchObject({ code: "verified_email_required" });
const first = await store.bootstrapAdmin(verifiedPrincipal, config);
const second = await store.bootstrapAdmin(verifiedPrincipal, config);
expect(second.internalProfileId).toBe(first.internalProfileId);
expect(fakeDb.created("auditEvents")).toHaveLength(1);
```

Cover pending Teacher request, Admin approval/suspension, email-index collision, class ownership, class archive/restore, create-only audit, and no delete method.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/firestore-dashboard-store.test.ts src/server/audit.test.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement focused repositories and Firestore transactions**

Use `profiles/{uid}`, `profileEmailIndex/{sha256(email)}`, `classrooms/{id}`, scoped subcollections, `studentMemberships/{uid}/classes/{id}`, and `auditEvents/{id}`. Do not add `delete()` to the Firestore abstraction.

```ts
export interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
}
export interface ClassroomRepository {
  create(principal: VerifiedPrincipal, input: CreateClassroomInput, context: MutationContext): Promise<Classroom>;
  listForPrincipal(principal: VerifiedPrincipal): Promise<ClassroomSummary[]>;
}
```

- [ ] **Step 4: Run store tests and all server type checks**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/firestore-dashboard-store.test.ts src/server/audit.test.ts && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/server/dashboard-store.ts apps/dashboard-web/src/server/firestore-dashboard-store.ts apps/dashboard-web/src/server/firestore-dashboard-store.test.ts apps/dashboard-web/src/server/audit.ts apps/dashboard-web/src/server/audit.test.ts firestore.indexes.dashboard.json
git commit -m "feat: add isolated dashboard data store"
```

### Task 4: Admin/profile APIs and server-side route isolation

**Files:**
- Modify: `apps/dashboard-web/src/app/api/profile/route.ts`
- Modify: `apps/dashboard-web/src/app/api/profile/route.test.ts`
- Create: `apps/dashboard-web/src/server/http.ts`
- Create: `apps/dashboard-web/src/server/http.test.ts`
- Create: `apps/dashboard-web/src/app/api/admin/profiles/route.ts`
- Create: `apps/dashboard-web/src/app/api/admin/profiles/route.test.ts`
- Create: Admin teacher/class/invite/audit route files under `apps/dashboard-web/src/app/api/admin/`

**Interfaces:**
- Consumes: principal, store, contracts, bootstrap matcher.
- Produces: server-owned profile state and exact Admin mutations from the spec; every sensitive response sets `Cache-Control: no-store`.

- [ ] **Step 1: Write failing route tests for bootstrap, pending Teacher, Admin approval/suspension, non-Admin denial, and audit failure**

```ts
const response = await POST(requestWith({ role: "admin", uid: "forged" }));
expect(response.status).toBe(400);
expect(store.bootstrapAdmin).not.toHaveBeenCalledWith(expect.objectContaining({ uid: "forged" }), expect.anything());
```

- [ ] **Step 2: Run route tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/profile/route.test.ts src/app/api/admin/**/*.test.ts src/server/http.test.ts`
Expected: FAIL on missing Admin routes/server guards.

- [ ] **Step 3: Implement `authenticateRequest`, `requireRole`, bounded JSON parsing, safe errors, and the exact routes**

Use route factories with injected dependencies for tests. Reject unknown body keys. Require non-empty reasons for suspend/archive/revoke/redeliver. Do not expose full verified email lists, bootstrap config, or raw audit internals.

- [ ] **Step 4: Run focused route tests, lint, and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/profile/route.test.ts src/app/api/admin/**/*.test.ts src/server/http.test.ts && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/app/api/profile apps/dashboard-web/src/app/api/admin apps/dashboard-web/src/server/http.ts apps/dashboard-web/src/server/http.test.ts
git commit -m "feat: add server-authorized admin lifecycle"
```

### Task 5: Secure invitation tokens and email adapters

**Files:**
- Create: `apps/dashboard-web/src/server/invite-token.ts`
- Create: `apps/dashboard-web/src/server/invite-token.test.ts`
- Create: `apps/dashboard-web/src/server/email-provider.ts`
- Create: `apps/dashboard-web/src/server/email-provider.test.ts`
- Create: `apps/dashboard-web/src/server/resend-email-provider.ts`
- Create: `apps/dashboard-web/src/server/resend-email-provider.test.ts`

**Interfaces:**
- Produces: `InviteTokenService.issue(inviteId)` and `.verify(serialized, storedDigest)`.
- Produces: `InvitationEmailProvider.send(input, attemptId): Promise<DeliveryResult>` and `CaptureInvitationEmailProvider`.

- [ ] **Step 1: Write failing cryptographic/provider tests**

```ts
const issued = service.issue("inv-1");
expect(issued.urlFragment).toMatch(/^inv-1\.[A-Za-z0-9_-]+$/);
expect(issued.digest).not.toContain(issued.urlFragment);
expect(service.verify(issued.urlFragment, issued.digest)).toBe(true);
await expect(createProvider(prodConfigWithoutKey)).rejects.toThrow(/RESEND_API_KEY/);
```

Cover 256-bit randomness, constant-time comparison, token rotation/replay, HTTPS public URL, verified sender domain, Reply-To from verified Teacher only, timeout, Resend 4xx/5xx, idempotency key, redaction, and zero network in capture mode.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/invite-token.test.ts src/server/email-provider.test.ts src/server/resend-email-provider.test.ts`
Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement token and provider adapters**

```ts
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": attemptId },
  body: JSON.stringify({ from, to: [input.recipientEmail], reply_to: input.teacherEmail, subject, html, text }),
  signal: AbortSignal.timeout(timeoutMs),
});
```

Never return/log the API key, message body, raw token, or full provider error.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/invite-token.test.ts src/server/email-provider.test.ts src/server/resend-email-provider.test.ts && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/server/invite-token* apps/dashboard-web/src/server/email-provider* apps/dashboard-web/src/server/resend-email-provider*
git commit -m "feat: add secure classroom invitation delivery"
```

### Task 6: Classroom, invitation, and membership APIs

**Files:**
- Create: route files/tests under `apps/dashboard-web/src/app/api/classes/`
- Create: route files/tests under `apps/dashboard-web/src/app/api/invitations/`
- Modify: `apps/dashboard-web/src/server/firestore-dashboard-store.ts`
- Modify: `apps/dashboard-web/src/server/firestore-dashboard-store.test.ts`

**Interfaces:**
- Consumes: approved Teacher authorization, invitation token/email adapters, transactional store.
- Produces: create/list/archive class; list members; invite/redeliver/revoke; authenticated inspect/accept.

- [ ] **Step 1: Write failing flow and IDOR tests**

```ts
expect((await createClass(asPendingTeacher, { name: "12-A" })).status).toBe(403);
expect((await acceptInvite(asWrongVerifiedEmail, token)).status).toBe(403);
expect((await acceptInvite(asInvitee, token)).status).toBe(200);
expect((await acceptInvite(asInvitee, token)).status).toBe(200); // idempotent same UID
```

Cover owner scoping, class archive, invite expiry/revocation/rotation, delivery failure, explicit Student addition, concurrent acceptance, email-index collision, reverse projection, no historical hard delete, rate limits, and audit events.

- [ ] **Step 2: Run route/store tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/classes/**/*.test.ts src/app/api/invitations/**/*.test.ts src/server/firestore-dashboard-store.test.ts`
Expected: FAIL on missing operations.

- [ ] **Step 3: Implement exact state transitions and routes**

Persist the pending invite before sending. Record `delivery_pending`, then `accepted|delivery_failed`; never create membership on send. Acceptance transaction checks digest, status, expiry, exact verified normalized email, explicit Student role, and writes membership/reverse projection/audit atomically.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/classes/**/*.test.ts src/app/api/invitations/**/*.test.ts src/server/firestore-dashboard-store.test.ts && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/app/api/classes apps/dashboard-web/src/app/api/invitations apps/dashboard-web/src/server/firestore-dashboard-store*
git commit -m "feat: add authorized classroom invitation flow"
```

### Task 7: Exact V3 assignment and insight adapters

**Files:**
- Create: `apps/dashboard-web/src/server/v3-assignment-adapter.ts`
- Create: `apps/dashboard-web/src/server/v3-assignment-adapter.test.ts`
- Create: `apps/dashboard-web/src/server/v3-insight-adapter.ts`
- Create: `apps/dashboard-web/src/server/v3-insight-adapter.test.ts`
- Modify: `packages/api-contracts/src/connected-dashboard.ts`
- Modify: `packages/api-contracts/src/connected-dashboard.test.ts`

**Interfaces:**
- Produces: `V3AssignmentAdapter.share({ jobId, emails, window, solutions }, bearer)` using only `POST /v3/paperdesk/jobs/{jobId}/share`.
- Produces exact `shareResults(shareId, bearer)`, `studentAnalysis(shareId, uid, bearer)`, and self-scoped Student read/launch projections.

- [ ] **Step 1: Write failing allowlist/projection tests**

```ts
expect(fetchMock.calls[0].url.pathname).toBe("/v3/paperdesk/jobs/JOB-1/share");
expect(fetchMock.calls[0].headers.get("Authorization")).toBe("Bearer fresh-token");
expect(projected).not.toHaveProperty("token");
await expect(adapter.get("/v3/paperdesk/shares")).rejects.toThrow(/not allowlisted/);
```

Cover encoded path attacks, `key`/cookie/admin-header exclusion, request caps/deduplication, Unix-window conversion, strict JSON/content type/body limits, timeouts, malformed success, upstream 401/403/409, and PII/token redaction.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/v3-assignment-adapter.test.ts src/server/v3-insight-adapter.test.ts`
Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement exact route templates and strict DTO projections**

Do not call `GET /v3/paperdesk/shares`; it can write legacy tokens. Do not automatically retry share POST. Force every Student `user_id` from `VerifiedPrincipal.uid`.

- [ ] **Step 4: Run adapter tests and production-boundary suite**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/server/v3-assignment-adapter.test.ts src/server/v3-insight-adapter.test.ts src/production-boundary.test.ts && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/server/v3-assignment-adapter* apps/dashboard-web/src/server/v3-insight-adapter* packages/api-contracts/src/connected-dashboard*
git commit -m "feat: add typed v3 assignment boundary"
```

### Task 8: Assignment, launch, insight, and reconciliation APIs

**Files:**
- Create: route files/tests under `apps/dashboard-web/src/app/api/classes/[id]/assignments/`
- Create: route files/tests under `apps/dashboard-web/src/app/api/assignments/`
- Modify: `apps/dashboard-web/src/server/firestore-dashboard-store.ts`
- Modify: `apps/dashboard-web/src/server/firestore-dashboard-store.test.ts`

**Interfaces:**
- Consumes: immutable accepted-member snapshots and exact V3 adapters.
- Produces: assignment creation/status, Student list/launch, Teacher aggregate/individual insight, and manual reconciliation by confirmed share ID.

- [ ] **Step 1: Write failing orchestration/security tests**

```ts
expect(await store.getAssignmentForStudent("a1", "not-recipient")).toBeNull();
expect((await createAssignment(owner, input)).state).toBe("active");
expect((await createAssignment(owner, input, timedOutV3)).state).toBe("reconciliation_required");
expect(v3Share).toHaveBeenCalledTimes(1);
```

Cover join/remove snapshot semantics, suspended Teacher, V3 job ownership rejection, no members, window validation, definite failure versus ambiguity, no blind retry, owner-supplied share ID verification, cross-assignment insight IDOR, removed-member historical insight, and no Admin insight access.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/classes/**/assignments/**/*.test.ts src/app/api/assignments/**/*.test.ts src/server/firestore-dashboard-store.test.ts`
Expected: FAIL on missing orchestration.

- [ ] **Step 3: Implement outbox-like assignment state transitions**

Write `creating` plus immutable snapshot first; invoke V3 once; commit `active`, `failed`, or `reconciliation_required`. Launch returns only a validated pinned-origin runner URL/path. Insight handlers prove dashboard ownership/snapshot before calling V3 and set `no-store`.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/api/classes/**/assignments/**/*.test.ts src/app/api/assignments/**/*.test.ts && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/app/api/classes apps/dashboard-web/src/app/api/assignments apps/dashboard-web/src/server/firestore-dashboard-store*
git commit -m "feat: connect classroom assignments to v3"
```

### Task 9: Typed browser client and protected route state machine

**Files:**
- Create: `apps/dashboard-web/src/client/connected-api.ts`
- Create: `apps/dashboard-web/src/client/connected-api.test.ts`
- Modify: `apps/dashboard-web/src/client/firebase-auth.ts`
- Modify: `apps/dashboard-web/src/client/firebase-auth.test.ts`
- Create/modify route pages under `apps/dashboard-web/src/app/`
- Modify: `apps/dashboard-web/src/components/production-dashboard.tsx`
- Modify: `apps/dashboard-web/src/components/production-dashboard.test.tsx`

**Interfaces:**
- Produces: same-origin client methods for every approved route; tokens supplied through a callback and never retained by the client object.
- Produces route states `signed_out|onboarding|pending_teacher|suspended|student|teacher|admin|error` from server profile only.

- [ ] **Step 1: Write failing token/route-isolation tests**

```ts
expect(localStorage.getItem("token")).toBeNull();
expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
expect(await openRoleRoute("teacher", studentProfile)).toEqual({ redirect: "/student" });
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/client/connected-api.test.ts src/components/production-dashboard.test.tsx src/client/firebase-auth.test.ts`
Expected: FAIL on missing client/profile states.

- [ ] **Step 3: Implement typed calls, fresh-token retry-once for 401, server-owned redirects, and cleared stale data during reauthorization**

Never retry mutations automatically. Never render protected cached data after a 401/403/profile state change.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/client/connected-api.test.ts src/components/production-dashboard.test.tsx src/client/firebase-auth.test.ts && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/client apps/dashboard-web/src/components/production-dashboard* apps/dashboard-web/src/app
git commit -m "feat: add role-authoritative dashboard navigation"
```

### Task 10: Academic Precision design system and Admin UI

**Files:**
- Modify: `apps/dashboard-web/src/app/globals.css`
- Modify: `apps/dashboard-web/src/app/globals.test.ts`
- Create: `apps/dashboard-web/src/components/academic-shell.tsx`
- Create: `apps/dashboard-web/src/components/academic-shell.test.tsx`
- Create: `apps/dashboard-web/src/features/admin/admin-dashboard.tsx`
- Create: `apps/dashboard-web/src/features/admin/admin-dashboard.test.tsx`
- Create: Admin page route.

**Interfaces:**
- Consumes: connected client and server profile state.
- Produces: shared 12/8/4 grid, desktop/sidebar/mobile shell, tokens, status/banners/tables/dialogs, and Admin management views.

- [ ] **Step 1: Write failing semantic/responsive tests**

```ts
expect(css).toContain("--color-primary: #3525cd");
expect(screen.getByRole("navigation", { name: /primary/i })).toBeVisible();
expect(screen.getByRole("button", { name: /approve teacher/i })).toBeEnabled();
expect(screen.queryByText(/student answers/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/globals.test.ts src/components/academic-shell.test.tsx src/features/admin/admin-dashboard.test.tsx`
Expected: FAIL on missing Academic Precision shell/Admin UI.

- [ ] **Step 3: Implement Stitch tokens and Admin states**

Use Inter; indigo/neutral/mint/amber roles; 4px rhythm; 16px cards; low elevation; 256px desktop sidebar; 64px header; fixed mobile bottom nav with content padding. Provide keyboard focus, `aria-busy`, status/alert live regions, confirmation/reason dialogs, and no color-only status.

- [ ] **Step 4: Run UI tests, lint, and typecheck**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/app/globals.test.ts src/components/academic-shell.test.tsx src/features/admin/admin-dashboard.test.tsx && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/app/globals* apps/dashboard-web/src/components/academic-shell* apps/dashboard-web/src/features/admin apps/dashboard-web/src/app/admin
git commit -m "feat: add academic precision admin experience"
```

### Task 11: Connected Teacher and Student experiences

**Files:**
- Create: `apps/dashboard-web/src/features/teacher/connected-teacher-dashboard.tsx`
- Create: `apps/dashboard-web/src/features/teacher/connected-teacher-dashboard.test.tsx`
- Create: `apps/dashboard-web/src/features/student/connected-student-dashboard.tsx`
- Create: `apps/dashboard-web/src/features/student/connected-student-dashboard.test.tsx`
- Modify protected Teacher/Student/invite route pages.

**Interfaces:**
- Consumes: Academic shell and connected client.
- Produces: full classroom/invite/assignment/result and student accept/class/launch/insight journeys.

- [ ] **Step 1: Write failing behavior/state tests**

```ts
await user.type(screen.getByLabelText(/student email/i), "learner@example.com");
await user.click(screen.getByRole("button", { name: /send invitation/i }));
expect(await screen.findByText(/delivery accepted/i)).toBeVisible();
expect(screen.getByRole("link", { name: /start test/i })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/examprep-api/));
```

Cover empty/loading/error, pending/suspended, invite expired/mismatch, class creation, delivery failure/redelivery, V3 capability absent, assignment preview/status/ambiguity, attempted/not-attempted, aggregate/individual insight, own classes, available/upcoming/attempted, and refresh timestamp.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/features/teacher/connected-teacher-dashboard.test.tsx src/features/student/connected-student-dashboard.test.tsx`
Expected: FAIL on missing connected experiences.

- [ ] **Step 3: Implement Stitch-mapped responsive experiences**

Adapt `classrooms_roster`, `assignment_results_insights`, `teacher_dashboard`, `student_dashboard`, and `student_personal_insights`. Use the existing V3 runner link; do not implement the Stitch attempt UI as a new runner. Do not render share-link, message-student, release-result, or generate-test controls.

- [ ] **Step 4: Run UI tests, lint, typecheck, and accessibility assertions**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/features/teacher/connected-teacher-dashboard.test.tsx src/features/student/connected-student-dashboard.test.tsx && pnpm --filter @vijeeta/dashboard-web lint && pnpm --filter @vijeeta/dashboard-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-web/src/features/teacher/connected-teacher-dashboard* apps/dashboard-web/src/features/student/connected-student-dashboard* apps/dashboard-web/src/app
git commit -m "feat: add connected teacher and student journeys"
```

### Task 12: Production documentation, secrets, IAM, and runbook

**Files:**
- Create: `docs/vijeeta-dashboard-api.md`
- Create: `docs/vijeeta-dashboard-operations.md`
- Create: `docs/vijeeta-dashboard-cicd.md`
- Create: `.github/workflows/dashboard-ci.yml`
- Create: `cloudbuild.dashboard-release.yaml`
- Modify: `docs/deploy-vijeeta-dashboard.md`
- Modify: `apps/dashboard-web/Dockerfile` if the new modules need trace allowlisting.
- Modify: `cloudbuild.dashboard.yaml` for non-secret pinned configuration only.

**Interfaces:**
- Documents the implemented contracts and exact approval-gated resources; it does not execute cloud commands.

- [ ] **Step 1: Write failing configuration/boundary assertions**

Extend `apps/dashboard-web/src/production-boundary.test.ts` to require all production secrets/config, forbid fixture/local modules from the image, and reject literal Admin email/API key/token pepper in compiled/browser sources.

- [ ] **Step 2: Run boundary tests and confirm RED**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/production-boundary.test.ts src/server/runtime-config.test.ts`
Expected: FAIL until documentation/config/image boundaries are complete.

- [ ] **Step 3: Write exact handoff/runbook documentation**

Document components/data boundaries, all sequence flows, V3 route reuse, Firestore schema/invariants/indexes, API contract, Resend/capture decision, observability/audit/reconciliation, limitations/evolution, and canary/rollback.

The Admin bootstrap secret mechanism is:

```json
{"version":1,"verifiedEmails":["sripadkulkarni@vedantu.com"],"firebaseUids":[]}
```

The approved operator creates `vijeeta-dashboard-admin-bootstrap` from a protected local file/stdin so the normalized value `sripadkulkarni@vedantu.com` does not enter source, build substitutions, image layers, chat, or shell history. The app requires `email_verified=true` and exact normalized match before the one-time audited grant.

Document exact resources: runtime SA, named Firestore database, custom no-delete datastore role/condition, three Secret Manager secrets and per-secret accessor bindings, audit log bucket/sink/log-writer, immutable image, new Cloud Run service only, Authorized Domain step, candidate/no-traffic smoke, promotion, rollback, backup/PITR, and reversible IAM removal.

Add a GitHub/GCP pipeline with these enforced boundaries:

- `.github/workflows/dashboard-ci.yml` runs frozen install, tests, lint, typecheck, and build for pull requests and pushes without cloud credentials or deploy permissions.
- `cloudbuild.dashboard-release.yaml` rejects non-40-character lowercase Git SHAs and any image destination except `asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy/vijeeta-dashboard:$COMMIT_SHA`.
- The release recipe runs the same test gate, builds that immutable image, deploys only Cloud Run service `vijeeta-dashboard` in `asia-south1`, and never names or mutates `examprep-api`, Firebase Hosting, DNS, or an existing service.
- The future GitHub Cloud Build connection/trigger watches `^main$`, requires approval before execution, uses a dedicated build service account, and is created only after the complete local release gate plus explicit cloud-write approval.
- The build identity gets only source read, Artifact Registry writer on the existing repository, Cloud Build logging, `run.developer` scoped for the new service where supported, and `iam.serviceAccountUser` on the dashboard runtime identity only. It receives no Editor/Owner, Firebase, Firestore data, DNS, Hosting, Secret payload accessor, or existing-service permissions.
- Initial repository publication pushes the reviewed feature branch to the already configured private `origin`; merging to `main` remains a reviewed repository action and does not authorize a cloud trigger or deploy.

- [ ] **Step 4: Run boundary tests, build, and container inspection**

Run: `pnpm --filter @vijeeta/dashboard-web test -- src/production-boundary.test.ts src/server/runtime-config.test.ts && pnpm --filter @vijeeta/dashboard-web build`
Expected: PASS; no fixture/local persistence/bootstrap value/secret appears in standalone trace or client chunks. Parse both Cloud Build YAML files and assert the release recipe contains only the exact project, region, image prefix, runtime service account, and `vijeeta-dashboard` service target.

- [ ] **Step 5: Commit**

```bash
git add docs/vijeeta-dashboard-api.md docs/vijeeta-dashboard-operations.md docs/vijeeta-dashboard-cicd.md docs/deploy-vijeeta-dashboard.md .github/workflows/dashboard-ci.yml apps/dashboard-web/Dockerfile cloudbuild.dashboard.yaml cloudbuild.dashboard-release.yaml apps/dashboard-web/src/production-boundary.test.ts
git commit -m "docs: add connected dashboard operations runbook"
```

### Task 13: Full E2E, security, visual, and independent review gate

**Files:**
- Create: `apps/dashboard-web/src/test/connected-e2e-smoke.test.ts`
- Create: `apps/dashboard-web/src/test/security-boundaries.test.ts`
- Create: `apps/dashboard-web/src/test/visual-reference.test.tsx`
- Create: `docs/vijeeta-dashboard-verification.md`

**Interfaces:**
- Proves the integrated local capture-mode flow and records release evidence. It does not contact Resend, V3 production, Firestore production, or GCP.

- [ ] **Step 1: Write the integrated flow before final fixes**

```ts
it("signs in, bootstraps admin, approves teacher, invites, joins, assigns, launches, and reads insights", async () => {
  const admin = await harness.signInVerified("bootstrap@example.test");
  await admin.approveTeacher(teacher.uid);
  const classroom = await teacher.createClass("Physics 12-A");
  const invite = await teacher.invite(classroom.id, student.email);
  await student.accept(invite.capturedToken);
  const assignment = await teacher.assign(classroom.id, "JOB-1");
  expect(await student.launch(assignment.id)).toMatchObject({ origin: APPROVED_V3_ORIGIN });
  expect(await teacher.insights(assignment.id)).toMatchObject({ attempted: 1 });
});
```

Security tests cover every adversarial case listed in the spec. The V3/Resend clients are strict fakes; assert zero unexpected calls.

- [ ] **Step 2: Run full local gate and fix only evidenced failures**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS across the monorepo.

- [ ] **Step 3: Capture deterministic visual comparisons**

Render sign-in, Admin, Teacher dashboard/roster/assignment insights, Student dashboard/insights, invite, and all loading/empty/error states at `2560×1250`, `1600×1280`, `780×1708`, `780×1402`, `390×844`, and breakpoint edges `767/768/1023/1024/1279/1280`. Compare manually against every supplied Stitch screenshot for hierarchy, grid, spacing, typography, color, elevation, overflow, navigation, drawer/modal, keyboard focus, zoom, and reduced motion. Record intentional product/security differences.

- [ ] **Step 4: Request independent security and code review**

Reviewers must inspect identity/role authority, Firestore database isolation, Admin bootstrap, invite crypto/email, IDOR, audit/redaction, V3 allowlists, ambiguity handling, image trace, and UI accessibility. Resolve all Critical/Important findings and rerun the full gate.

- [ ] **Step 5: Commit verified release evidence**

```bash
git add apps/dashboard-web/src/test docs/vijeeta-dashboard-verification.md
git commit -m "test: verify connected dashboard release gate"
```

### Task 14: Pre-deploy approval checkpoint

**Files:**
- Modify only `docs/vijeeta-dashboard-verification.md` with final immutable SHA and evidence links.

**Interfaces:**
- Produces an exact green/red pre-deploy report. Performs no cloud write.

- [ ] **Step 1: Verify clean scoped status and immutable commit history**

Run: `git status --short && git log --oneline --decorate -15 && git diff --check`
Expected: only known preserved untracked fixture metadata; all implementation changes committed.

- [ ] **Step 2: Re-run the final gate from the committed SHA**

Run: `pnpm install --frozen-lockfile && pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 3: Produce the approval request**

Report verified facts versus assumptions, initial Admin mechanism (not the secret value), Resend domain/key prerequisite, exact database/IAM/secrets/audit/service/image/region changes, GitHub connection and approval-required main trigger, dedicated build identity/IAM, authorized-domain step, candidate smoke limits, rollback, and any residual risk. Stop before database, IAM, secret, connection, trigger, build, deploy, Firebase, or provider writes.

- [ ] **Step 4: Push the reviewed feature branch only after the full gate**

Run: `git push --set-upstream origin feat/connected-dashboard`
Expected: the private GitHub repository receives the immutable reviewed commits; `origin/main` and all cloud resources remain unchanged.

- [ ] **Step 5: Commit the final evidence update**

```bash
git add docs/vijeeta-dashboard-verification.md
git commit -m "docs: record dashboard predeploy evidence"
```
