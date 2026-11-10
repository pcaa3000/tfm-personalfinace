# Brechas de seguridad — auditoría OWASP Top 10:2025

Fecha de auditoría: 2026-11-01 · Re-auditoría: 2026-11-10 (post-merge PR #1 — ver `## Re-auditoría 2026-11-10` para el estado vigente) · Alcance: revisión estática del diseño (`docs/05-seguridad-privacidad.md`, `docs/02`) contra el código vigente de `apps/api` y `apps/web` en la rama `feature/ledger-income-expenses`. No incluye pruebas dinámicas, pentesting ni revisión de infraestructura de despliegue. Este documento complementa a `docs/05`; no lo reemplaza.

## Resumen por categoría

| Categoría OWASP Top 10:2025 | Estado | Resumen |
|---|---|---|
| A01 — Broken Access Control (incluye SSRF) | Alineado | Workspace derivado del token en servidor, filtros de propietario en repositorios, 404 indistinguible; probado e2e |
| A02 — Security Misconfiguration | Brecha | Auth fail-open hacia el resolver dev, sin hardening HTTP (Helmet/CORS/límites), Zod sin validación estricta de campos |
| A03 — Software Supply Chain Failures | Parcial | Lockfile + depcruise; sin edad mínima de paquetes ni gate de `pnpm audit` en CI |
| A04 — Cryptographic Failures | Parcial | JWT solo ES256/RS256, IDs `crypto.randomUUID`; cola IndexedDB en claro y sin vaciado al cerrar sesión |
| A05 — Injection | Alineado | Drizzle parametrizado (query builder tipado), Zod en frontera HTTP, React sin HTML crudo |
| A06 — Insecure Design | Alineado | Invariantes de dominio en todos los paths de mutación, idempotencia obligatoria, libro inmutable con revisiones, Result pattern |
| A07 — Authentication Failures | Parcial | Resource server JWT robusto; falta flujo OIDC+PKCE del cliente web (T6) y el fallback dev es fail-open |
| A08 — Software or Data Integrity Failures | Parcial | Transacciones atómicas + idempotencia; la cola offline no está ligada a la sesión que la creó |
| A09 — Security Logging and Alerting Failures | Brecha | Sin logger estructurado con redacción ni eventos de seguridad (401/404, fallos de token) |
| A10 — Mishandling of Exceptional Conditions | Brecha | Sin ExceptionFilter global, sin rate limiting, detalles crudos de Zod en respuestas 400 |

## Controles verificados como alineados

### A01 — Broken Access Control

- El workspace nunca llega del cliente: se resuelve en servidor desde `(issuer, subject)` (`JwtCallerResolver`, `DeterministicWorkspaceAdapter`).
- Todos los repositorios filtran por `workspaceId` en lectura y escritura (`DrizzleTransactionRepository`, `DrizzleAccountRepository`, `DrizzleCategoryValidationAdapter`).
- Recurso inexistente y recurso ajeno responden igual (404) — e2e `auth-oidc.e2e.spec.ts` "keeps workspaces isolated between token subjects".
- IDs opacos vía `crypto.randomUUID` (`CryptoIdGenerator`).
- SSRF: la API no descarga URLs provistas por el cliente (sin superficie actual; se mantiene como restricción de diseño en `docs/05`).

### A05 — Injection

- Persistencia 100% parametrizada con Drizzle; no hay SQL crudo sin interpolación segura.
- Validación Zod de body y query en todos los controladores.
- Sin `dangerouslySetInnerHTML` en web; React escapa la salida por defecto.

### A06 — Insecure Design

- Invariantes financieras en dominio (`INV-TRX-01..05`, `INV-CTA-01/03`, `Money` en `bigint` con escala ISO 4217) verificadas en alta **y** edición (lección T8a aplicada).
- Idempotencia obligatoria: `idempotencyKey` requerida y unicidad `(workspaceId, idempotencyKey)`.
- Libro inmutable: anulación sin borrado y `TransactionRevision` por cambio con actor.
- El dato financiero solo se confirma con validación humana según `docs/04`/`docs/05`.

## Brechas detectadas

| ID | OWASP | Severidad | Ubicación | Brecha |
|---|---|---|---|---|
| GAP-SEC-01 | A02/A07 | Alta | `apps/api/src/composition/app.module.ts`, `identity-workspace/infrastructure/http/dev-caller.ts` | Si `AUTH_MODE` no es `oidc` (incluida la variable ausente) se activa `DevHeaderCallerResolver`; y sin header `x-dev-user` cae en el subject por defecto `dev-user` → autenticación implícita (fail-open) |
| GAP-SEC-02 | A02 | Alta | `apps/api/src/main.ts` | Bootstrap sin Helmet (HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`), sin política CORS explícita ni límites de payload deliberados |
| GAP-SEC-03 | A02 | Media | Controladores HTTP (`transactions`, `accounts`, `workspace`, `categories`) | Schemas Zod sin validación estricta: los campos inesperados se eliminan silenciosamente, contra el requisito de `docs/05` de validar campos inesperados |
| GAP-SEC-04 | A10 | Media-alta | Composición de la API | Error handler global existe (`onError` de Hono) pero errores no controlados de Drizzle/infraestructura pueden filtrar detalles internos; además los 400 devuelven `details: parsed.error.issues` crudo |
| GAP-SEC-05 | A10/A02 | Media | Toda la API | Sin rate limiting por IP/identidad/operación sensible (exigido en `docs/05`); no hay middleware de rate limiting |
| GAP-SEC-06 | A09 | Media | API | Sin logging estructurado con lista de campos prohibidos (`docs/05`) ni eventos de seguridad observables (rechazos 401, intentos de acceso cruzado 404) |
| GAP-SEC-07 | A03 | Media | `package.json` de ambas apps, `.npmrc`/CI | Rangos `^` sin política de edad mínima de publicación (`minimum-release-age`) y sin `pnpm audit` como gate de integración |
| GAP-SEC-08 | A04/A08 | Media | `apps/web/src/features/ledger/offline/queue.ts`, `sync.ts` | Cola IndexedDB en claro, no se vacía al cerrar sesión y los ítems no están ligados al workspace/sesión que los creó — otra identidad en el mismo navegador drenaría el outbox con su propio token |
| GAP-SEC-09 | A07 | Parcial — pendiente de alcance | `apps/web` | Flujo OIDC Authorization Code + PKCE del cliente web pendiente (T6-web, bloqueado por proyecto Supabase real); `api.ts` hoy no envía `Authorization` |
| GAP-SEC-10 | A02 | Baja | `GET /health` | Endpoint público con timestamp: exposición mínima aceptable hoy; revisar si crece con métricas o dependencias |

## Pendientes de alcance (no son brechas)

Funcionalidades de seguridad diseñadas en `docs/05` pero aún sin feature asociada en el roadmap: carga de tickets/audio (cuarentena, URLs firmadas, límites de tipo/tamaño), consentimiento y revocación de proveedores OCR/voz, exportación con reautenticación, borrado de cuenta, jobs pg-boss, RLS opcional y el rol Operación. Re-evaluar al implementar esos cortes.

## Remediación sugerida (orden de prioridad)

1. **GAP-SEC-01** — fail-closed: rechazar `AUTH_MODE` desconocido y exigir header en el resolver dev (sin subject por defecto).
2. **GAP-SEC-02** — Helmet + `enableCors` con allowlist de orígenes + límite explícito de body.
3. **GAP-SEC-04** — `ExceptionFilter` global con respuesta `{code, message}` genérica en 500 y `details` de Zod saneados.
4. **GAP-SEC-05** — middleware de rate limiting (p. ej. `hono-rate-limiter`) con límites por operación sensible.
5. **GAP-SEC-03** — validación estricta de campos en schemas HTTP (`z.strictObject`/equivalente).
6. **GAP-SEC-06** — logger estructurado con redacción de campos prohibidos y eventos 401/404.
7. **GAP-SEC-08** — vaciar `pendingTransactions` al cerrar sesión y guardar `workspaceId` por ítem para abortar el sync si cambia la identidad.
8. **GAP-SEC-07** — `.npmrc` con edad mínima de publicación + `pnpm audit --prod` en CI.
9. **GAP-SEC-09** — completar T6-web cuando exista el proyecto Supabase real.
10. **GAP-SEC-10** — revisión al enriquecer el health check.

## Referencias

- OWASP Top 10:2025 — https://owasp.org/Top10/2025/
- `docs/05-seguridad-privacidad.md` — política de diseño: amenazas, controles y criterios de aceptación
- `odd/tasks/ledger-income-expenses.md` — `T14` (esta auditoría), `L13`

## Re-auditoría 2026-11-10 (estado vigente)

Re-verificación estática sobre `main` post-merge del PR #1 (login web real, `VITE_AUTH_BYPASS` fail-closed, modos dev/qa, worker pg-boss + feed de notificaciones, módulos balance/currencies). Las rutas originales del doc referenciaban NestJS; el wiring vigente es `apps/api/src/hono/composition.ts`, `hono/app.ts`, `middleware/errors.ts`, `src/main.ts`.

### Estado por brecha

| ID | Estado 2026-11-10 | Evidencia |
|---|---|---|
| GAP-SEC-01 | **ABIERTA — bloqueante** | `hono/composition.ts` `envFromProcess`: cualquier `AUTH_MODE` ≠ `oidc` (incluida ausente) → `authMode:"dev"`; `dev-caller.ts` sin header → subject por defecto `dev-user`. T26 solo cerró el lado web. |
| GAP-SEC-02 | **ABIERTA — bloqueante** | `hono/app.ts` sin `cors`/`secureHeaders`/`bodyLimit`; `main.ts` sin opciones de `serve`. |
| GAP-SEC-03 | ABIERTA (programable) | Schemas `z.object` sin `.strict()` en todas las rutas — campos extra se eliminan en silencio. |
| GAP-SEC-04 | PARCIAL → ABIERTA (programable) | Envelope 500 genérico ya existe (`middleware/errors.ts`), pero `details: parsed.error.issues` crudo en 9 sitios (transactions ×3, accounts ×2, categories ×2, currencies ×2? — ver NEW-12 además). |
| GAP-SEC-05 | **ABIERTA — bloqueante** | Sin middleware de rate limiting en `apps/api/src`. |
| GAP-SEC-06 | ABIERTA — peor | Solo `console.log/error`; sin logger estructurado ni eventos 401/404. Ver NEW-SEC-12. |
| GAP-SEC-07 | ABIERTA — peor que lo documentado | No existe `.npmrc` ni `.github/workflows/` — no hay CI en absoluto, así que no hay gate de `pnpm audit` ni `minimum-release-age`. |
| GAP-SEC-08 | **ABIERTA — bloqueante, ampliada** | `queue.ts` sin binding de workspace/sesión por ítem; `auth.tsx` `signOut` no vacía `pendingTransactions` ni el query cache de React Query (creado a nivel módulo en `App.tsx`) → segunda identidad en el mismo navegador drena transacciones ajenas y ve cache ajeno. |
| GAP-SEC-09 | **CERRADA** | Login web real implementado: `supabase.ts` cliente PKCE, `auth.tsx` → `setAccessTokenProvider`, `api.ts` envía `Authorization: Bearer`; `VITE_AUTH_BYPASS` exige `import.meta.env.DEV && "true"` (fail-closed, T26); `AuthGate` muestra pantalla de misconfig. |
| GAP-SEC-10 | ABIERTA (baja, sin cambio) | `GET /health` público `{status, service, timestamp}` — exposición mínima aceptable. |

### Brechas nuevas

| ID | OWASP | Severidad | Ubicación | Brecha |
|---|---|---|---|---|
| NEW-SEC-11 | A10/A02 | Media | `drizzle-notification.repository.ts` | `GET /api/v1/notifications` sin `LIMIT`/paginación — crece con cada evento de dominio; lecturas no acotadas por request (amplificado por GAP-05). |
| NEW-SEC-12 | A09/A10 | Media | `middleware/errors.ts` | Excepciones desconocidas → 500 genérico **sin loguear `err`** — fallos silentes, sin rastro forense. |
| NEW-SEC-13 | A02 | Baja | `hono/composition.ts`, `worker.ts` | `DATABASE_URL` con fallback silencioso a `postgresql://tfm:tfm-local-dev@localhost:5432/...` — despliegue mal configurado apunta a un default en vez de fallar rápido. |
| NEW-SEC-14 | — | Info | `apps/api/package.json` script `qa` | Embebe project ref + JWKS URL de Supabase reales — metadata pública anon, no secreto; aceptable. |

### Superficies nuevas verificadas limpias

- `GET /api/v1/balance` y `GET /api/v1/notifications`: auth + workspace-scoped en consulta parametrizada.
- Currencies CRUD: auth en las 5 rutas + scoping por workspace (hereda GAP-03/04 únicamente).
- Worker pg-boss: `FOR UPDATE SKIP LOCKED`, at-least-once + `onConflictDoNothing` por `outboxEventId`.
- Secretos: `apps/web` solo usa `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anon/publishable); ningún `service_role`/`DATABASE_URL` en web.

### Veredicto de publicación

**Bloqueantes que deben cerrarse antes de un deploy público** (en orden):
1. **GAP-SEC-01** — auth fail-open descalifica: cualquier deploy sin `AUTH_MODE=oidc` regala el workspace `dev-user` a tráfico anónimo. Fail-closed en modo desconocido/ausente + sin subject por defecto.
2. **GAP-SEC-02** — sin CORS allowlist (cualquier origen puede invocar la API con token filtrado) y sin límite de body (DoS de memoria trivial). Headers de seguridad en todas las respuestas.
3. **GAP-SEC-05** — sin rate limiting en una API de escritura; con NEW-11 es el principal riesgo de disponibilidad.
4. **GAP-SEC-08** — cola offline no ligada a identidad: en navegador compartido, una segunda sesión drena datos financieros ajenos. Vaciar `pendingTransactions` + query cache al `signOut`; ligar ítems al `workspaceId`.
5. **NEW-SEC-12** — 500s invisibles: una línea junto a GAP-06.

**Programables para MVP (no bloquean):** GAP-03, GAP-04 (barato, recomendado igual), GAP-06, GAP-07 (levantar CI básico + `pnpm audit`/`minimum-release-age` — la ausencia total de CI es en sí un flag pre-release), GAP-10, NEW-11 (cap de filas), NEW-13, NEW-14.
