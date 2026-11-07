# Spike: Drizzle ORM + Hono (evaluación paralela a Prisma + NestJS)

Spike acotado en rama `spike/drizzle-hono` para decidir con evidencia si la
persistencia migra a Drizzle y el HTTP a Hono. **No reemplaza ni borra la
implementación existente**: convive en archivos paralelos.

## Specs

- **S1** (L2, L3): Drizzle mapea el esquema PostgreSQL existente (tablas creadas por
  migraciones Prisma, columnas camelCase) y provee `DrizzleTransactionRepository` +
  `DrizzleAccountRepository` implementando los puertos `TransactionRepositoryPort` /
  `AccountRepositoryPort` existentes, sin tocar domain/application.
- **S2** (L1, L3): Hono expone las mismas rutas `/api/v1/transactions` y
  `/api/v1/accounts` que los controllers Nest actuales, con middleware de auth
  compartido (CallerResolverPort + WorkspaceContextPort), validación zod y mapeo de
  errores `{code, message}` equivalente. La app se construye por una factory
  `createApp(deps)` testeable vía `app.request()` sin levantar servidor.
- **S3** (L3): Los 27 specs existentes quedan en verde sin modificación
  (domain/application intactos). Los specs nuevos del spike: RED observado → GREEN.
- **S4** (L3): El entregable es evidencia para decidir (diff + resultados de specs +
  `main.hono.ts` ejecutable), no una migración comprometida.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|---|---|---|---|---|---|
| T1 | Rama `spike/drizzle-hono`, deps (drizzle-orm, pg, hono, @hono/node-server, drizzle-kit, @types/pg), doc ODD, Postgres+migraciones | S4 | parent | done | setup |
| T2 | `src/drizzle/schema.ts` + Drizzle repos (transactions, accounts) + specs de integración contra Postgres real | S1, S3 | worker | done | RED 16/16 → GREEN 16/16 integración real; suite 343 + archivos hono in-flight |
| T3 | `src/hono/` app factory + middlewares + rutas + specs `app.request()` | S2, S3 | worker | done | RED 21/21 → GREEN 21/21; suite 364/364, typecheck+depcruise limpios |
| T4 | `src/main.hono.ts` composición real + suite completa + typecheck + lint + depcruise | S3 | parent | done | 364/364, 36 files; typecheck+lint+depcruise 0 violaciones; smoke test E2E OK (health, account, txn, idempotencia, filtros) |
| T5 | Espejo Engram + reporte de evidencia para decisión | S4 | parent | done | espejo `odd/spike-drizzle-hono/tasks` sincronizado; spike completado por decisión del usuario (migrar ambos) |

## Log

- **L1**: "puedes explorar la opcion de usar drizzle orm en lugar de prisma orm y honojs en lugar nestjs"
- **L2**: "Lo que me interesa de drizzel es el SQL explicito y es mas entendible que Prisma. En cuanto Hono, explicame si seria mas costoso que nestjs para las caracteristicas faltantes como auth, el OCR para las imagenes y audio el voz, reportes y un agente que te consejos respecto a tus finanzas personales, en la arquitectura actual que es clean architecture y monolito modular."
- **L3**: "si" — aprueba el spike propuesto: portar `transactions` + `accounts` completos a Drizzle+Hono en una rama y correr los specs existentes como evidencia.
- **L4**: Análisis previo registrado en conversación: acoplamiento Prisma = 7 archivos infra + schema + seed; acoplamiento Nest = 6 controllers + app.module + main, ya en modo "framework-thin" (zod manual, auth manual por handler, `toHttpError` duplicado). La decisión se documentará en `docs/02` según el resultado.
- **L5**: Setup T1: rama creada; deps instaladas (drizzle-orm 0.45.4, pg 8.23.1, hono 4.13.16, @hono/node-server 2.1.6, drizzle-kit 0.31.11, @types/pg 8.23.1); `docker compose up -d postgres` OK; `prisma migrate deploy`: 6/6 aplicadas.
- **L6**: T2 completada (worker): schema drizzle espejo exacto de las 6 tablas Prisma; ambos repos implementan los puertos sin tocar domain/application; 16 specs de integración contra Postgres real en verde. Desviaciones menores documentadas por el worker: mapper local (no reusa transaction.mapper por tipos `TransactionGetPayload`), ids de revisión randomUUID vs `${id}-rev-${n}`, `ilike` con comodines igual que `contains` de Prisma.
- **L7**: T3 completada (worker): `createApp(deps)` + middleware auth (resuelve caller+workspace una vez por request, elimina boilerplate por handler) + `onError` con sobres `{code,message}` (404 `_NOT_FOUND`, 409 `_TAKEN`, 400, 500). Desviaciones vs Nest documentadas: orden validación/auth invertido (400 vs 401 ante body inválido sin auth), JSON malformado → INVALID_BODY, trailing slash estricto, query params duplicados colapsan. 21 specs `app.request()` en verde.
- **L8**: T4 completada (parent): `main.hono.ts` = composición explícita sin container (Drizzle para transactions/accounts; Prisma para workspace/categorías/monedas fuera de scope); `dev:hono` script; `drizzle.config.ts` agregado a tsconfig include; graceful shutdown propio (~15 líneas). Smoke test real: health, POST /accounts (workspace + seed PEN vía provisioner Prisma), POST /transactions, replay idempotente (mismo id), list con `?q=`, todo OK sobre el mismo Postgres.
