# Hardening post-migración Drizzle

Mejoras decididas tras el análisis de desviaciones del spike/migración
(ver `odd/tasks/migrate-drizzle-hono.md` L19 y conversación posterior).

## Specs

- **S1** (L20): El provisioning de workspace es atómico: insert + `ensureDefaultCurrency`
  + `ensureSeedCategories` corren dentro de `db.transaction()`. Si un provisioner
  falla, no queda fila de workspace huérfana y `resolve` rechaza. Cambio de contrato
  respecto al quirk heredado de Prisma (tragar el fallo y devolver workspace sin
  provisionar) — la spec que lo fijaba se reescribe a propósito.
- **S2** (L20): `updatedAt` se defiende también en base de datos: trigger
  `set_updated_at()` BEFORE UPDATE sobre `currencies_currencies` (única tabla con
  `updatedAt`), además del set explícito del repo. Migración drizzle-kit custom +
  aplicada a la DB de dev.
- **S3** (L20): El ctor de `DrizzleWorkspaceAdapter` pasa de puertos a factories
  `(db) => Port`, sin filtrar tipos de Drizzle a los puertos de aplicación.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|---|---|---|---|---|---|
| T1 | RED+refactor: provisioning atómico en `createWorkspace` (factories + tx) | S1, S3 | parent | done | RED (no rechazaba + fila huérfana) → GREEN 8/8 |
| T2 | RED+trigger `set_updated_at` + migración custom + spec | S2 | parent | done | RED (sin bump) → GREEN; `0001_set_updated_at_trigger.sql` aplicada a dev y verificada en DB fresca (bumped=t) |
| T3 | docs/02 + cierre + espejo Engram | S2 | parent | done | docs/02 restricción de trigger agregada; suite 421/421 |

## Log

- **L20**: "ok" — el usuario aprueba implementar las mejoras 5 (trigger updatedAt)
  y 6 (provisioning atómico) del análisis de desviaciones.
- **L21**: Diseño S3: el ctor de `DrizzleWorkspaceAdapter` pasa a factories
  `(db: DrizzleDb) => Port` para poder bindear los provisioners al tx de
  `db.transaction` sin filtrar tipos drizzle a los puertos de aplicación.
  Composición: `(tx) => new DrizzleCurrencyRepository(tx)` etc.
- **L22**: Cambio de contrato consciente: la spec que fijaba el quirk Prisma
  (provisioner falla → resolve OK con workspace sin provisionar) se reescribe a
  rollback + reject. La carrera concurrente se cubre igual: quien pierde el
  unique de identityKey re-lee la fila del ganador (ya provisionada).
- **L23**: Ojo con `drizzle-kit push`: el trigger no vive en `schema.ts`
  (drizzle no modela triggers) → `push` lo ofrece para borrar como objeto
  desconocido; aceptarlo así (warning interactivo) o documentarlo al usar push.
