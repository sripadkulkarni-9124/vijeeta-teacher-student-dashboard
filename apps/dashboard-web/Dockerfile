# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable \
  && corepack install --global pnpm@11.19.0

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json .npmrc ./
COPY apps/dashboard-web/package.json apps/dashboard-web/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/configuration/package.json packages/configuration/package.json
COPY packages/design-system/package.json packages/design-system/package.json
COPY packages/product-fixtures/package.json packages/product-fixtures/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

ARG NEXT_PUBLIC_DASHBOARD_MODE
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_DASHBOARD_MODE=${NEXT_PUBLIC_DASHBOARD_MODE}
ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}
ENV NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}

# Fail the image build rather than producing a fixture-mode or cross-project
# browser bundle. The API key is public Firebase web configuration, but is
# intentionally supplied by the build environment and never written here.
RUN test "${NEXT_PUBLIC_DASHBOARD_MODE}" = "v3-proxy" \
  && test -n "${NEXT_PUBLIC_FIREBASE_API_KEY}" \
  && test "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}" = "neetcompanion-50b1f.firebaseapp.com" \
  && test "${NEXT_PUBLIC_FIREBASE_PROJECT_ID}" = "neetcompanion-50b1f" \
  && test "${NEXT_PUBLIC_FIREBASE_APP_ID}" = "1:840759107103:web:68dfff0b2e8c209babff2a"

COPY packages/api-contracts packages/api-contracts
COPY packages/configuration packages/configuration
COPY packages/design-system packages/design-system
COPY apps/dashboard-web/package.json apps/dashboard-web/package.json
COPY apps/dashboard-web/next.config.ts apps/dashboard-web/next.config.ts
COPY apps/dashboard-web/tsconfig.json apps/dashboard-web/tsconfig.json
COPY apps/dashboard-web/src apps/dashboard-web/src

# Tests are never part of the runtime build context. Keeping them out of the
# builder also prevents test-only fixtures and dev-only imports from affecting
# the production typecheck.
RUN find apps/dashboard-web/src -type f \( -name '*.test.*' -o -name '*.spec.*' \) -delete

# These modules belong only to the development fixture entry. Remove them
# before Next builds its production graph so they cannot be traced into the
# standalone runtime, even when the monorepo context contains the source.
RUN rm -f \
  apps/dashboard-web/src/components/dashboard-prototype.tsx \
  apps/dashboard-web/src/components/role-landing.tsx \
  apps/dashboard-web/src/client/demo-api.ts \
  apps/dashboard-web/src/client/view-models.ts \
  apps/dashboard-web/src/server/store.ts \
  apps/dashboard-web/src/server/service.ts

RUN pnpm --filter @vijeeta/dashboard-web build

# The workspace package manifest still contains the development-only fixture
# dependency so the separate fixture entry can run locally. Remove that
# declaration from Next's generated standalone manifest before the runtime
# stage; no fixture package is traced by the production graph.
RUN node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const file = "apps/dashboard-web/.next/standalone/apps/dashboard-web/package.json"; const pkg = JSON.parse(readFileSync(file, "utf8")); if (pkg.dependencies) delete pkg.dependencies["@vijeeta/product-fixtures"]; writeFileSync(file, JSON.stringify(pkg));'

FROM node:24.19.0-bookworm-slim AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone trace includes only runtime dependencies. Static assets are
# copied separately because Next intentionally leaves them outside standalone.
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/dashboard-web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/dashboard-web/.next/static ./apps/dashboard-web/.next/static

# No developer state or fixture JSON is copied into the image. Production
# persistence is server-side and must not depend on the container filesystem.
USER nextjs
EXPOSE 8080

CMD ["node", "apps/dashboard-web/server.js"]
