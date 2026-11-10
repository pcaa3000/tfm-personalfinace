# Feature: deploy-mvp — configuración de publicación free-tier

Objetivo: dejar listo el despliegue MVP — Netlify (SPA), Render (API +
worker), Supabase Postgres+Auth — sin tocar código de aplicación.

Branch: `feature/deploy-mvp`
| Espejo Engram: `odd/deploy-mvp/tasks`

## Specs

- S1 (L1/L2): `apps/api/Dockerfile` multi-stage que compila el workspace
  con pnpm y corre `node dist/src/main.js` (API) o `dist/src/worker.js`
  (worker) — `tsx` es devDependency, prod corre JS compilado.
- S2 (L1/L2): `render.yaml` blueprint con dos servicios (web api + worker)
  y todas las env vars documentadas (`DATABASE_URL`, `AUTH_MODE=oidc`,
  `OIDC_*`, `CORS_ORIGINS`, `RATE_LIMIT_*`, `PORT`, `NODE_ENV=production`).
- S3 (L1/L2): `netlify.toml` — build `pnpm --filter @tfm/web build`,
  publish `apps/web/dist`, SPA fallback, y proxy `/api/*` → API host de
  Render (mantiene same-origin: CORS no aplica y CSP `connect-src 'self'`
  sigue válida).
- S4 (L1/L2): `docs/08-despliegue-mvp.md` — matriz de env vars, nota
  Supabase pooler session-mode (pg-boss/pg Pool no toleran transaction
  mode), migraciones drizzle, checklist pre-publicación (XFF, NODE_ENV,
  AUTH_MODE, compose no expuesto).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Dockerfile api + render.yaml | S1, S2 | inline | done | docker build OK; `node dist/src/main.js` falla fail-fast: `DATABASE_URL must be set` y `AUTH_MODE=dev is forbidden when NODE_ENV=production` verificados dentro de la imagen |
| T2 | netlify.toml + docs/08 + validación `vite build` | S3, S4 | inline | done | netlify.toml + docs/08; estructural (sin runner de tests para config) |

## Log

- L1 (2026-11-10): "para la bd usaremos supabase. en cuanto a la app estaba
  pensando usar Vercel, sin embargo quisiera que me des alternativas...
  free tier generosa" — recomendación entregada: Netlify + Render/Koyeb +
  Supabase; Vercel descartado (requeriría reempaquetar la API a serverless
  + cron para el drain-outbox).
- L2 (2026-11-10): "si, preparar con lo recomendo" — alcance: artefactos de
  deploy para Netlify (web) + Render (api+worker) + Supabase, sin cambios
  de código de aplicación.
- L3 (2026-11-10): T1/T2 done. `docker build` de la imagen API OK
  (~34s). Verificación en vivo dentro del contenedor: ambos fail-fast de
  producción disparan correctamente. Worker queda como `node
  dist/src/worker.js` en la misma imagen (Render cobra workers: docs/08
  recomienda Koyeb/Fly free o diferirlo — el outbox no pierde eventos).
- L4 (2026-11-10): RDD nativa del candidato `review-1d45e2efa5d2ad61`
  (lentes risk/readability, tier medium, 5 files / 254 líneas). Resultado:
  **approved** sin bloqueantes; acknowledge quemado. 3 advisories: el
  contenedor corre como root (agregar `USER node` en runner — follow-up
  barato), el placeholder `API_HOST` de netlify.toml (ya documentado), y
  `plan: starter` del worker vs el comentario free-tier (ambos señalados
  en docs/08).
- L5 (2026-11-10): "aplica el user mode, cambie la imagen del dockerfile a
  lts-apline" — advisory R1-docker-runner-root aplicado: runner usa
  `node:lts-alpine` + `USER node` (+`--chown=node:node` en el COPY).
  `corepack` no existe en alpine → pnpm@12.15.0 pineado vía `npm i -g`.
  Rebuild OK; verificado en imagen: `whoami` = node, Node v26.13.0, guard
  AUTH_MODE=dev+prod dispara igual. Imagen ~577MB.
- L6 (2026-11-10): RDD nativa del delta Dockerfile `review-5e0d0b25bcf1e538`
  (lente risk, tier medium, 28 líneas). Resultado: **approved**, acknowledge
  quemado. 2 advisories: tag mutable `node:lts-alpine` (considerar pin por
  digest en hardening post-MVP) e install de pnpm sin verificación de
  integridad (misma categoría — supply-chain follow-up).
