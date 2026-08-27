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

ARG NEXT_PUBLIC_DASHBOARD_MODE=v3-proxy
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_DASHBOARD_MODE=${NEXT_PUBLIC_DASHBOARD_MODE}
ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}
ENV NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}

COPY packages packages
COPY apps/dashboard-web/package.json apps/dashboard-web/package.json
COPY apps/dashboard-web/next.config.ts apps/dashboard-web/next.config.ts
COPY apps/dashboard-web/tsconfig.json apps/dashboard-web/tsconfig.json
COPY apps/dashboard-web/src apps/dashboard-web/src

# Tests are never part of the runtime build context. Keeping them out of the
# builder also prevents test-only fixtures and dev-only imports from affecting
# the production typecheck.
RUN find apps/dashboard-web/src -type f \( -name '*.test.*' -o -name '*.spec.*' \) -delete

RUN pnpm --filter @vijeeta/dashboard-web build

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
