# syntax=docker/dockerfile:1
# TFM API — production image (S1, deploy-mvp).
# Multi-stage: pnpm workspace install -> tsc build -> pnpm deploy (prod
# deps only). Runs compiled JS; `tsx` is a devDependency and never ships.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---- Install + build ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api ./apps/api
RUN pnpm install --filter @tfm/api... --frozen-lockfile
RUN pnpm --filter @tfm/api build
# `pnpm deploy` produces an isolated package with production deps only.
RUN pnpm deploy --filter @tfm/api --prod /prod

# ---- Runtime ----
FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod ./
EXPOSE 3000
# Default: API server. The worker uses the same image with
# `node dist/src/worker.js` as its start command (see render.yaml).
CMD ["node", "dist/src/main.js"]
