# Feature: security-prelaunch — segunda ronda OWASP previo a publicación

Objetivo: cerrar las brechas remanentes de la re-auditoría OWASP Top 10:2025
antes de publicar la web en internet.

Branch: `feature/security-prelaunch` (desde `main` post-merge PR #2)
| Test runner: `pnpm vitest` | Espejo Engram: `odd/security-prelaunch/tasks`

## Specs

- S1 (L1/L2): `AUTH_MODE=dev` no puede convivir con `NODE_ENV=production`:
  `envFromProcess` (y/o `buildApp`) falla rápido si ambas valen eso. Sin
  bypass implícito; error claro nombrando la causa.
- S2 (L1/L2): el rate limiter cubre también métodos de lectura en
  `/api/v1/*`, con límite propio configurable (`RATE_LIMIT_READ_MAX`,
  default 240/min, `RATE_LIMIT_READ_WINDOW_MS` comparte window config o
  propio — decisión de implementación documentada). 429
  `{code:"RATE_LIMITED"}` al exceder. El límite de escrituras existente
  (60/min) no se altera.
- S3 (L1/L2): la web recibe headers de seguridad reales al servirse:
  `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Frame-Options`/equivalente. Como el hosting es
  estático y desconocido: solución portable = `<meta http-equiv>` CSP en
  `index.html` + archivo `public/_headers` (formato Netlify/compatible)
  documentado en `docs/07`; CSP permite lo que la app usa (self,
  Supabase https/wss, API).
- S4 (L1/L2): `docs/07` actualizado con la segunda re-auditoría y el estado
  post-remediación de estos puntos.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | API — guard prod AUTH_MODE=dev + rate limit en lecturas (`hono/composition.ts`, `hono/app.ts`, `middleware/rate-limit.ts`, specs) | S1, S2 | worker | done | `5ef4a3b`; RED→GREEN: 8 fallos → 38/38 verdes en composition/app/rate-limit specs |
| T2 | Web — CSP meta + `_headers` + docs/07 update | S3, S4 | worker | done | `e07dff2`; verificación estructural (sin superficie de test para HTML/`_headers`); suite web verde |
| T3 | Web — CSP inyectada solo en build (plugin `tfm-csp-meta`) + fix unhandled rejection en `auth.spec.tsx` + fix flake Gestión menu en `LedgerPage.spec.tsx` | S3, proceso | worker | done | `e07dff2`; RED exit 1 → GREEN exit 0 en auth.spec.tsx; `vite build` confirma CSP en dist/index.html; flake resuelto en L5: focused 3× exit 0, suite completa 2× exit 0 (217/217) |

## Log

- L1 (2026-11-10): "verifica y dime si aun existen brechas de seguridad, de
  acuerdo al OWASP TOP 10 2025 con el codigo actual de la app. Ten en cuenta
  que el proximo paso es realizar realizar la publicacion de la web en
  internet" — segunda re-auditoría delegada a gentle-ai-explore.
  Bloqueantes: AUTH_MODE=dev sin guard de producción (composition.ts:86),
  X-Forwarded-For spoofable en rate limit (queda como advisory: depende del
  proxy front), GETs sin rate limit, tokens Supabase en localStorage, web
  sin CSP/headers, Postgres 5432 con creds débiles en compose, sin
  auditoría de 401/429, TLS DB depende de sslmode.
- L2 (2026-11-10): "si" — alcance autorizado: fix (1) guard producción
  AUTH_MODE=dev, (3) rate limit en lecturas, (5) headers de seguridad en la
  web. Advisory fuera de alcance: XFF spoofing (requiere decisión de
  hosting/proxy), localStorage tokens (requiere migración a httpOnly
  cookies, decisión mayor), compose 5432 (solo-dev, verificar en deploy),
  auditoría A09 (follow-up).
- L3 (2026-11-10): implementación T1+T2 delegada a worker. S1: guard
  `NODE_ENV=production` en rama `authMode==="dev"` de `envFromProcess`.
  S2: `rateLimitRead` (default 240/60_000, `RATE_LIMIT_READ_MAX`/
  `RATE_LIMIT_READ_WINDOW_MS` con `parsePositiveInt`) + segunda instancia
  del limiter con `shouldLimit` = complemento de WRITE_METHODS — buckets
  independientes. S3: `<meta http-equiv>` CSP en `index.html` +
  `public/_headers` (Netlify/CF Pages). S4: sección `## Segunda
  re-auditoría 2026-11-10` en docs/07 con advisories abiertos (XFF,
  localStorage, compose-5432, auditoría 401/429, sslmode).
- L4 (2026-11-10): dos fixes de seguimiento sobre T2. Fix A — el meta CSP
  bloqueaba `pnpm dev` (preamble inline de react-refresh): se movió al
  plugin `tfm-csp-meta` en `vite.config.ts` (`apply:"build"` +
  `transformIndexHtml`), fuera de `index.html`; `vite build` confirma la
  CSP en `dist/index.html` y dev queda sin ella. Fix B — `pnpm vitest`
  en apps/web salía exit 1 con 217/217 verdes por un unhandled
  rejection: `Probe` disparaba `void signOut()` y `signOut` re-lanza el
  `{error}` del mock; la spec ahora usa un probe que captura el error y
  aserta la propagación intencional. auth.spec.tsx: exit 0, 12/12. Suite
  web completa: 0 unhandled errors pero exit 1 intermitente por flake
  pre-existente en `LedgerPage.spec.tsx` "opens the Gestión menu" —
  resuelto en L5 tras autorización de superficie.
- L5 (2026-11-10): fix del flake del Gestión menu. Causa raíz real:
  `document.querySelector(".MuiModal-root")` es ambiguo — el Menu de
  Gestión también renderiza dentro de un Modal MUI y puede seguir
  desmontándose, así que el Escape caía en el modal del menú y el diálogo
  nunca cerraba (no era solo timing). Fix: keydown sobre
  `cuentasDialog.closest(".MuiModal-root")` (determinista) +
  `waitForElementToBeRemoved(cuentasDialog, {timeout: 3000})` con
  headroom para el unmount. Evidencia: focused spec 3× exit 0 (16/16),
  suite completa apps/web 2× exit 0 (217/217, 0 unhandled errors).
- L6 (2026-11-10): cierre y commits. Slice boundary: 462 líneas
  authored en 2 commits (`5ef4a3b` api, `e07dff2` web+docs) — justo por
  encima del umbral ~400; estrategia de delivery del proyecto: single PR
  `feature/security-prelaunch -> main` (igual que PR #1 y #2).
- L7 (2026-11-10): RDD nativa del candidato completo `review-0d9366387930c12c`
  (lentes risk/readability/reliability, tier high, 13 files / 466 líneas).
  Resultado: **approved** sin findings bloqueantes; acknowledge quemado
  (`native-approved-acknowledgement-completed`, rev `713fe3f7`). 9
  advisories informativos: CSP de `_headers` incluye `http://localhost:3000`
  en connect-src (quitar si el host nunca sirve dev), posible interacción
  CSP↔PWA `autoUpdate` (verificar SW registrado en deploy), headers no
  aplicables a hosts que ignoran `_headers`, mapa de ventanas del limiter
  (growth bajo flood ya acotado por MAX_TRACKED_CLIENTS), línea stale en
  docs/07 sobre ubicación de la CSP, y notas menores de legibilidad en
  app.ts/vite.config.ts. Todos follow-ups, ninguno reabre el candidato.
