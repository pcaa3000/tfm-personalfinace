# Feature: security-hardening — cierre de brechas OWASP para publicación

Objetivo: cerrar las 5 brechas bloqueantes + 2 baratas identificadas en la
re-auditoría OWASP Top 10:2025 para que la app pueda publicarse.

Branch: `feature/security-hardening` (nueva, desde `main` post-merge PR #1)
| Test runner: `pnpm vitest` (api/web) | Espejo Engram: `odd/security-hardening/tasks`

## Specs

- S1 (L1): "ok, verifica los temas de seguridad respecto al owasp top 10 2025,
  para que app pueda publicarse" — re-auditoría documentada en `docs/07`
  (sección `## Re-auditoría 2026-11-10`).
- S2 (L2): "yo decidi por la opcion 1" = "Cerrar los 5 bloqueantes + baratos":
  GAP-SEC-01 fail-closed, GAP-SEC-02 headers/CORS/body-limit, GAP-SEC-05
  rate limiting, GAP-SEC-08 logout limpia cola+cache, NEW-SEC-12 log de 500s
  + GAP-SEC-04 (sanear `details` de Zod) y NEW-SEC-13 (`DATABASE_URL`
  fail-fast). Actualizar `docs/07`.
- S3 (docs/07): **GAP-SEC-01** — `AUTH_MODE` desconocido o ausente debe
  fallar cerrado (la API no arranca o rechaza resolución); el resolver dev
  no tiene subject por defecto: sin `x-dev-user` válido → 401, no `dev-user`.
- S4 (docs/07): **GAP-SEC-02** — `hono/app.ts` aplica headers de seguridad
  en todas las respuestas (`secureHeaders` o equivalente), CORS con
  allowlist de orígenes configurada (dev: `localhost:5173`), y límite de
  body deliberado en las rutas de escritura.
- S5 (docs/07): **GAP-SEC-05** — rate limiting por IP (o identidad) en la
  API de escritura con límite configurable; respuesta 429 al exceder.
- S6 (docs/07): **GAP-SEC-08** — `signOut` vacía `pendingTransactions` y el
  query cache de React Query; los ítems de la cola quedan ligados al
  `workspaceId`/`subject` que los creó y el sync aborta si la identidad
  cambió (no drena con token ajeno).
- S7 (docs/07): **NEW-SEC-12** — excepciones desconocidas se loguean
  (`console.error` o logger) antes del 500 genérico. **GAP-SEC-04** — los
  400 no devuelven `parsed.error.issues` crudo: `details` saneado (code +
  path, sin internals de zod).
- S8 (docs/07): **NEW-SEC-13** — `DATABASE_URL` ausente falla rápido
  (arranque o primera conexión), sin fallback silencioso a localhost.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | API — auth fail-closed + DATABASE_URL fail-fast (`hono/composition.ts`, `dev-caller.ts`, `worker.ts`, specs) | S3, S8 | worker | pending | — |
| T2 | API — hardening HTTP: secureHeaders + CORS allowlist + bodyLimit + rate limiting + sanitize zod details + log 500s (`hono/app.ts`, `middleware/errors.ts`, routes/*) | S4, S5, S7 | worker | pending | — |
| T3 | Web — logout limpia cola + query cache; ítems ligados a workspace (`auth.tsx`, `offline/queue.ts`, `sync.ts`, `App.tsx`, specs) | S6 | worker | pending | — |
| T4 | docs/07 actualizado a post-remediación + verify + cierre | S1, S2 | inline | pending | — |

## Log

- L1 (2026-11-10): "ok, verifica los temas de seguridad respecto al owasp
  top 10 2025, para que app pueda publicarse" — re-auditoría delegada:
  5/10 gaps abiertos, GAP-09 cerrado por T6-web, 4 brechas nuevas
  (NEW-SEC-11..14). Documentada en `docs/07` sección Re-auditoría.
- L2 (2026-11-10): "yo decidi por la opcion 1" — cierre de los 5
  bloqueantes + GAP-04 y NEW-13. Se abren T1–T4 en branch
  `feature/security-hardening`.
