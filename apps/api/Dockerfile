# syntax=docker/dockerfile:1
# TFM API — production image (S1, deploy-mvp).
# Multi-stage: pnpm workspace install -> tsc build -> pnpm deploy (prod
# deps only). Runs compiled JS as the unprivileged `node` user on
# lts-alpine; `tsx` is a devDependency and never ships.

FROM node:lts-alpine AS base
# corepack is not shipped in the alpine image — pin pnpm directly.
RUN npm install -g pnpm@12.15.0
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
FROM node:lts-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
EXPOSE 3000
# Default: API server. The worker uses the same image with
# `node dist/src/worker.js` as its start command (see render.yaml).
CMD ["node", "dist/src/main.js"]
