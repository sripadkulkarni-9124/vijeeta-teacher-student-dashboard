# Vijeeta dashboard deployment and identity/store change proposal

Status: **approval-gated proposal; deployment paused pending identity and data-store review**.

This runbook is for a new dashboard service only. It is deliberately written so that a local build, image push, Cloud Run deployment, Firestore creation, IAM grant, migration, or Firebase Console change cannot be mistaken for approval. No cloud writes have been run for this proposal.

## Proposed resources

| Resource | Proposed value | Boundary |
| --- | --- | --- |
| GCP project | neetcompanion-50b1f | Do not alter another project. |
| Cloud Run region | asia-south1 | New service only. |
| Cloud Run service | vijeeta-dashboard | Never replace, route, or roll back an existing service. |
| Artifact Registry | asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy | Existing repository; use it exactly and confirm access read-only before push. |
| Image tag | asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy/vijeeta-dashboard:<FULL_GIT_SHA> | Use the full source Git SHA, never latest. |
| Firestore database | projects/neetcompanion-50b1f/databases/vijeeta-dashboard | New named database only; no default database, legacy collections, rules, or data. |

### Firestore location gate

asia-south1 is the preferred location only if the Firestore database API currently supports it for this project and database mode. Before any create request, an operator must perform a read-only location/support check and record the result. If asia-south1 is unsupported, stop and obtain explicit approval for a compatible nearby multi-region (for example, a currently supported Asia multi-region) after reviewing residency, latency, and cost. Do not silently substitute a location and do not create a database while this decision is unresolved. The database location is immutable after creation.

The exact proposed resource remains projects/neetcompanion-50b1f/databases/vijeeta-dashboard. A read-only support check has confirmed that asia-south1 is supported for this proposal; record that evidence before any create request. If the project/database mode changes and support no longer holds, stop and obtain explicit approval for a compatible nearby multi-region. The database location is immutable after creation.

The following are exact read-only preflight commands for the approved operator to run and attach to the change record. They are command templates only and were not run as part of this paused deployment work:

    gcloud config get-value project
    gcloud artifacts repositories describe cloud-run-source-deploy --location=asia-south1 --project=neetcompanion-50b1f
    gcloud run services list --region=asia-south1 --project=neetcompanion-50b1f
    gcloud firestore locations list --project=neetcompanion-50b1f
    gcloud firestore databases describe vijeeta-dashboard --project=neetcompanion-50b1f

The repository/service listings must be recorded before any push or Cloud Run change. A not-found result for the named database is expected while it is unused; it is evidence for review, not permission to create it. Do not run create, deploy, set-iam-policy, traffic, index, backup, or Firebase Console write operations until the approvals below are recorded.

## Identity and data authority

The browser talks to the dashboard server only. There must be no browser Firestore SDK, client Firestore credentials, onSnapshot, WebSocket, or other push-realtime path. The server uses the dedicated dashboard runtime service account to read and write only the named database. No service-account key file is shipped in the image or stored in source.

Sign-in identity is the authenticated Firebase/Auth subject accepted by the server. Onboarding and profile records are server-owned. The server resolves the canonical user profile, organisation membership, and role from the named database; a browser-selected role, query parameter, or cached fixture role is presentation state and never authority. Role changes and membership changes therefore take effect on the next authenticated refresh.

V3 dashboard reads are request/refresh based: the server returns a redacted, role-appropriate snapshot on page load or explicit refresh. The client must not infer authority from stale state, subscribe to push updates, or read legacy/default collections. Submit/share/invitation delivery remains out of the deployment smoke path.

### Proposed named-database shape

The first migration proposal is intentionally small and reviewable:

- `profiles/{uid}` — the only collection used by the first release; canonical UID, separate internal profile ID, allowed and active role, onboarding completion, and timestamps. It contains no credentials or provider tokens.
- `organisations/{organisationId}/members/{uid}` — reserved for reviewed organisation membership and role provenance.
- `organisations/{organisationId}/classrooms/{classroomId}` and `.../enrolments/{uid}` — reserved for future dashboard-owned classroom/roster data.

The reserved classroom paths have no production API in the first release. Class, roster, invitation, quick-test, assignment, submit, and share controls therefore remain disabled previews. They must not be presented as live-backed until their contracts, authorization policy, indexes, and server APIs are separately reviewed.

These are proposals, not an authorization to create them. Do not import, mirror, backfill, or query any legacy/default database collections or rules.

## Least-privilege IAM proposal

Create the dedicated runtime service account vijeeta-dashboard@neetcompanion-50b1f.iam.gserviceaccount.com only after explicit approval. Grant it access scoped to the named database where the platform supports database-level IAM. The minimum application permissions are the equivalent of:

- read/write entities required by the approved profile, membership, and dashboard read-model paths (datastore.entities.get, list, create, update, and delete only where a reviewed mutation requires them);
- read-only database metadata/index status needed by health or startup checks (datastore.databases.get and approved index/list metadata permissions, if required by the chosen API).

Do not grant roles/owner, roles/editor, roles/datastore.owner, project-wide broad database-admin roles, service-account user/admin, IAM admin, import/export, or key-management permissions. If the chosen IAM model cannot restrict access to vijeeta-dashboard, stop for a security decision rather than granting project-wide access. The service account must not be impersonated by the browser or by an unrelated existing runtime identity.

The smallest verified change uses Google's documented per-database IAM condition. `roles/datastore.user` includes entity deletion, but the first-release code exposes no delete operation; delete protection and the database equality condition limit the blast radius to this new database. A custom no-delete role would be a separate, broader IAM-design change.

Exact approval-gated commands (do not run without the recorded approval):

    gcloud iam service-accounts create vijeeta-dashboard \
      --project=neetcompanion-50b1f \
      --display-name='Vijeeta dashboard runtime' \
      --description='Keyless Cloud Run runtime for named Firestore database vijeeta-dashboard'

    gcloud firestore databases create \
      --database=vijeeta-dashboard \
      --location=asia-south1 \
      --type=firestore-native \
      --edition=standard \
      --delete-protection \
      --enable-pitr \
      --project=neetcompanion-50b1f

    gcloud projects add-iam-policy-binding neetcompanion-50b1f \
      --project=neetcompanion-50b1f \
      --member='serviceAccount:vijeeta-dashboard@neetcompanion-50b1f.iam.gserviceaccount.com' \
      --role='roles/datastore.user' \
      --condition='expression=resource.name=="projects/neetcompanion-50b1f/databases/vijeeta-dashboard",title=vijeeta_dashboard_database_only,description=Runtime access only to the Vijeeta dashboard named database'

The IAM condition is enforced for server client-library access. The runtime never lists databases or uses the Cloud Console. Allow up to five minutes for IAM propagation before treating an initial permission denial as a release failure.

## Migrations, indexes, backup, and rollback

Migrations must be versioned, idempotent, forward-only, and run by an explicitly approved server-side job against vijeeta-dashboard only. Each migration must state its reads, writes, estimated cost, owner, and rollback/forward-fix procedure. A migration must fail closed if its configured database is absent or is "(default)". No destructive migration, legacy import, or cross-database copy is permitted in this rollout.

Indexes must be declared and reviewed before the first production read. Create only indexes used by approved V3 queries, wait for build completion, and record the index definition and database resource. Index deletion is a separate approval. Do not rely on automatic index prompts from an unreviewed production request.

Before enabling writes, obtain an approved backup/export and retention policy for the named database, including encryption, access, restore test, and cost owner. Restore rehearsal must target an isolated database/project. Rollback of the application image is independent from data rollback; a bad migration is handled by a reviewed forward fix or approved restore, never by pointing the service at the legacy/default database.

## Environment contract

Only values approved for the new service may be supplied:

| Variable | Meaning | Required handling |
| --- | --- | --- |
| NODE_ENV=production | Runtime mode | Set in the image. |
| PORT=8080 | Cloud Run listener | Set in the image; do not expose another port. |
| VIJEETA_RUNTIME_MODE=production | Enables approved server-backed mode | Omit for local fixture demo; set only after identity/store approval. |
| VIJEETA_FIREBASE_PROJECT_ID=neetcompanion-50b1f | Server Firebase project | Required and rejected if it names any other project. |
| VIJEETA_FIRESTORE_DATABASE_ID=vijeeta-dashboard | Named database | Must never be `default` or `(default)`; startup fails closed on mismatch. |
| VIJEETA_V3_BASE_URL=<approved-server-read-origin> | Required production server/read adapter origin | No client direct Firestore URL and no legacy origin; the current runtime config fails closed when this is absent. |
| VIJEETA_BUILD_ID=<full-git-sha> | Health/build identity | Immutable source revision reported by `/api/health`. |
| NEXT_PUBLIC_DASHBOARD_MODE=v3-proxy | Browser build mode | Baked into the immutable image; production must not use fixture mode. |
| NEXT_PUBLIC_FIREBASE_API_KEY=<provided-at-build-time> | Existing public Firebase Web app API key | Required but intentionally not embedded in this runbook; pass from the approved build environment only. It is public web config, not an Admin credential. |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=neetcompanion-50b1f.firebaseapp.com | Existing public Firebase Auth domain | Exact pinned value; builder rejects any other or empty value. |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID=neetcompanion-50b1f | Existing public Firebase project | Exact pinned value; builder rejects any other or empty value. |
| NEXT_PUBLIC_FIREBASE_APP_ID=1:840759107103:web:84391539f65c7aa4abff2a | Existing public Firebase Web app ID | Exact pinned value; builder rejects any other or empty value. |

Use Cloud Run's attached service identity and Secret Manager for any future approved secret. Do not put credentials, service-account JSON, Firebase Admin keys, or client Firestore configuration in the image, .env files, fixtures, or browser bundle.

## Packaging and immutable image

Build from the repository root with apps/dashboard-web/Dockerfile. The Next configuration uses standalone output and traces from the monorepo root. The final image runs Node 24 as non-root user nextjs, listens on 0.0.0.0:8080, and copies only traced runtime files and static assets. The Dockerfile uses explicit source COPY entries and removes development-only fixture modules before Next builds its production graph, so .local state, caches, manifests, docs, DashboardPrototype, the /api/demo implementation, and the product-fixtures trace cannot enter the standalone runtime even when the monorepo root is the Docker context; apps/dashboard-web/.dockerignore separately excludes the same classes for direct app-context tooling. No local fixture data is copied into the image and no production persistence directory is created.

Local, non-cloud checks:

    pnpm install --frozen-lockfile
    pnpm --filter @vijeeta/dashboard-web build
    docker build --file apps/dashboard-web/Dockerfile --tag vijeeta-dashboard:<FULL_GIT_SHA> \
      --build-arg NEXT_PUBLIC_DASHBOARD_MODE=v3-proxy \
      --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="${NEXT_PUBLIC_FIREBASE_API_KEY}" \
      --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=neetcompanion-50b1f.firebaseapp.com \
      --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=neetcompanion-50b1f \
      --build-arg NEXT_PUBLIC_FIREBASE_APP_ID=1:840759107103:web:84391539f65c7aa4abff2a .
    docker run --rm --publish 8080:8080 --env NODE_ENV=production --env PORT=8080 vijeeta-dashboard:<FULL_GIT_SHA>

The Docker build requires package-registry access for the image builder's frozen install; this is an image-build dependency, not a permission to run cloud commands. If dependencies are unavailable offline, report that as a build prerequisite rather than weakening the lockfile or using an unfrozen install. Export the approved public API key in `NEXT_PUBLIC_FIREBASE_API_KEY` only in the local build environment or CI secret store; never replace the variable reference above with a literal key in source, docs, image labels, or command history.

After the resource/IAM approval is recorded, the immutable cloud build uses the checked-in `cloudbuild.dashboard.yaml` recipe. Both substitutions are mandatory; `_IMAGE` must be the exact Artifact Registry path ending in the full source Git SHA, never `latest`:

    gcloud builds submit . \
      --project=neetcompanion-50b1f \
      --config=cloudbuild.dashboard.yaml \
      --substitutions=_IMAGE=asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy/vijeeta-dashboard:<FULL_GIT_SHA>,_FIREBASE_API_KEY="${NEXT_PUBLIC_FIREBASE_API_KEY}"

This command is a cloud write because it creates build records and pushes the image. Do not run it during read-only preflight or before the explicit build approval.

## Approval-gated rollout

1. **Read-only preflight:** confirm the project, existing Artifact Registry repository, Cloud Run API availability, Firestore location support, and current service list. Save the results. Do not create resources or alter an existing service.
2. **Review and approve identity/store:** approve the exact database resource, confirmed asia-south1 location, collection shape, indexes, backup policy, dedicated service account, and least-privilege binding. Database creation and IAM each require explicit approval immediately before the write.
3. **Build:** run the local checks above, then build one image tagged with the full Git SHA. Push only that immutable tag to asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy after approval.
4. **Create the new service:** deploy only vijeeta-dashboard in asia-south1, using the dedicated runtime identity and PORT=8080. Do not update traffic or configuration for any existing service. Do not enable API mode until the named database and IAM approvals are complete.
5. **Candidate/no-traffic:** if the platform supports it, deploy the revision with no traffic. If it does not, stop for an explicit equivalent approval; never use an existing service as a staging target.
6. **Read-only smoke:** check GET /api/health and approved GET/read flows only (for example, the V3 dashboard read with a test identity). Verify response redaction, role authority, named-database selection, and refresh behavior. Do not call POST/submit/share/invitation endpoints, send email/WhatsApp, generate a live test, or mutate student data.
7. **Promote:** route traffic only to the new vijeeta-dashboard revision after smoke evidence and approval. Promotion means changing this new service only.
8. **Monitor and rollback:** rollback only the new service to its prior known-good revision on health/read failures, auth/role leakage, wrong-database access, elevated error/latency, or unexpected writes. Do not roll back by changing another service, IAM to broad roles, database location, or database target.

The current local app exposes fixture/demo routes alongside the V3 BFF and health route. Health returns unavailable until the required production read dependency is configured. A missing or unavailable /api/health or approved V3 read is a pre-promotion blocker, not a reason to map health to a mutating/demo endpoint.

## Firebase Authorized Domain post-create step

After the new Cloud Run service has been created and its stable hostname is known, obtain explicit approval to add exactly that hostname (for example, vijeeta-dashboard-<region>-<project-number>.<run.app> as returned by Cloud Run) to the Firebase Authentication Authorized domains list for the intended Firebase project. Confirm the exact hostname and project in the change record first. Do not add wildcards, localhost-only entries as a production substitute, legacy service hostnames, or an unverified preview URL. This is a post-create Console/IAM step and must not be performed during this paused phase.

## Forbidden changes

This rollout must not:

- modify, replace, route traffic to, or roll back any existing Vijeeta service;
- use the legacy/default Firestore database, collections, rules, exports, or data;
- install a browser Firestore SDK, expose client credentials, add push realtime, or make role choice authoritative;
- create the named database, service account, IAM binding, index, backup, secret, Artifact Registry repository, or Cloud Run service without explicit approval;
- call submit, share, invitation-delivery, test-generation, or other mutating flows in smoke tests;
- import local fixture JSON or .local/dashboard-state.json into the image or cloud;
- weaken the frozen lockfile, use latest, run as root, ship service-account keys, or silently change the approved region;
- change application contracts, server routes, client code, tests, manifests, or lockfiles as part of this deployment proposal.
