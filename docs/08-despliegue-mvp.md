# 08 — Despliegue MVP (free tier)

Arquitectura de publicación decidida (L1/L2 de `odd/tasks/deploy-mvp.md`):

| Pieza | Plataforma | Artefacto |
|---|---|---|
| SPA (`apps/web`) | Netlify free | `netlify.toml` + `public/_headers` |
| API (`apps/api` main) | Render free web service | `apps/api/Dockerfile` + `render.yaml` |
| Worker (`apps/api` worker) | Koyeb/Fly free instance (o Render pago) | misma imagen, `node dist/src/worker.js` |
| DB + Auth | Supabase free | connection string session-mode |

## Por qué este reparto

- `_headers` de Netlify aplica los headers de seguridad sin tocar nada.
- El proxy `/api/*` de Netlify mantiene same-origin: **CORS no aplica** y
  la CSP `connect-src 'self'` sigue siendo correcta.
- La API corre igual que en dev (Node persistente), incluido el drain del
  outbox — nada de reescribir a serverless.
- Vercel quedó descartado: hubiera requerido reempaquetar la API como
  función + cron para el worker.

## Matriz de env vars

### Netlify (site env)

| Var | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon public key del proyecto |

### API (Render / Koyeb)

| Var | Valor | Nota |
|---|---|---|
| `NODE_ENV` | `production` | **obligatoria**: activa el guard que prohíbe `AUTH_MODE=dev` |
| `AUTH_MODE` | `oidc` | |
| `OIDC_ISSUER` | `https://<project>.supabase.co/auth/v1` | |
| `OIDC_AUDIENCE` | `authenticated` | |
| `OIDC_JWKS_URI` | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` | |
| `DATABASE_URL` | pooler **session mode** + `sslmode=require` | ver abajo |
| `CORS_ORIGINS` | — | innecesaria mientras Netlify proxee `/api`; si el SPA llamara directo, poner el dominio Netlify exacto |
| `RATE_LIMIT_*` | defaults o ajustados | el limiter confía en XFF: Render/Koyeb/Netlify lo sobrescriben correctamente |
| `PORT` | inyectado por la plataforma | el código ya respeta `process.env.PORT` |

### Worker

| Var | Valor |
|---|---|
| `DATABASE_URL` | **misma** session-mode pooler URL de la API |
| `WORKER_DRAIN_MS` | `2000` (opcional) |

## Supabase: connection string correcta

`pg` Pool y `pg-boss` **no funcionan sobre el pooler en transaction mode**
(puerto 6543, prepared statements/session features rotos). Usar:

- **Session pooler**: `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require` — pooler host, puerto **5432**, o
- conexión directa `db.<ref>.supabase.co:5432` si el plan lo permite.

Aplica a API **y** worker.

## Migraciones

Las migraciones drizzle (`apps/api/drizzle/*.sql`) se corren manualmente
contra la DB de producción antes del primer deploy y tras cada cambio de
schema:

```bash
DATABASE_URL="<session-pooler-prod>" pnpm --filter @tfm/api db:migrate
```

## Checklist pre-publicación

- [ ] `netlify.toml`: reemplazar `API_HOST` por el hostname real del
      servicio Render (los redirects de Netlify no expanden env vars).
- [ ] `NODE_ENV=production` y `AUTH_MODE=oidc` en el servicio API (el
      guard nuevo lo exige; de hecho si NODE_ENV=production y AUTH_MODE=dev
      la API **no arranca** — ese es el comportamiento deseado).
- [ ] `DATABASE_URL` con `sslmode=require`, session-mode pooler.
- [ ] Migraciones corridas contra la DB de prod.
- [ ] `docker-compose.yml` **solo local** — jamás en el host público.
- [ ] Headers verificados en prod: `curl -sI https://<sitio>.netlify.app | grep -i "content-security\|x-frame"`.
- [ ] Service Worker registrado en prod (DevTools → Application) — la CSP
      nueva podría interferir si faltara algún origen (advisory de review).
- [ ] Login Supabase real contra la API vía proxy `/api/v1` (un GET
      autenticado devuelve 200, no 401).
- [ ] Worker corriendo (o decisión explícita de diferirlo — los eventos
      quedan en outbox sin pérdida).

## Post-MVP

- Worker dedicado pago en Render, o migrar a Koyeb/Fly según uso real.
- Migración de tokens a httpOnly cookies (advisory abierto en `docs/07`).
- Observabilidad de 401/429 (advisory abierto en `docs/07`).
