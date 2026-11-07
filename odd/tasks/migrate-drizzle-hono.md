# Migración: Drizzle ORM + Hono (reemplazo de Prisma + NestJS)

Continuación autorizada del spike `spike-drizzle-hono` (L3): el usuario eligió
migrar completamente. Rama `spike/drizzle-hono` (se renombra/mergea al cerrar).
Los artefactos del spike ya probados (drizzle schema/db, repos de ledger y
accounts, hono app+middleware+rutas, main.hono.ts) son la base.

## Specs

- **S1** (L9): Toda la persistencia restante pasa a Drizzle sobre el mismo
  esquema físico, implementando los puertos existentes sin tocar
  domain/application: `DrizzleCategoryRepository` (CategoryRepositoryPort +
  CategoryCatalogProvisionerPort), `DrizzleCategoryValidationAdapter`
  (CategoryValidationPort + CategoryCatalogPort), `DrizzleCurrencyRepository`
  (CurrencyRepositoryPort + CurrencyEnabledPort + WorkspaceCatalogProvisionerPort),
  `DrizzleCurrencyUsageAdapter` (CurrencyUsagePort), `DrizzleWorkspaceAdapter`
  (WorkspaceContextPort + WorkspaceSettingsPort).
- **S2** (L9): Toda la superficie HTTP restante pasa a Hono preservando rutas,
  sobres `{code,message}` y status codes: categories, currencies, workspace.
- **S3** (L9): Los 95 e2e HTTP (`transactions` 54, `accounts` 10,
  `currencies` 21, `auth-oidc` 10) corren contra la app Hono + Postgres real
  con cambios mínimos y confinados a `test/e2e-helpers.ts` y fixtures.
- **S4** (L9): NestJS y Prisma quedan eliminados de deps y de `src/` +
  `prisma/` + `test/`; `main.hono.ts` pasa a ser el entrypoint real; scripts
  actualizados (`dev`, `db:migrate` → drizzle-kit, `db:seed` → drizzle).
- **S5** (L9): `docs/02-stack-tecnologico.md` refleja la decisión (Drizzle,
  Hono, migraciones drizzle-kit, composición explícita) y las desviaciones
  observadas en el spike.
- **S6** (L8/L9): Desviaciones del spike o se corrigen o se aceptan
  documentadas: orden validación→auth (400 Nest vs 401 Hono), JSON malformado,
  trailing slash estricto, params duplicados colapsados, ids de revisión
  randomUUID.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|---|---|---|---|---|---|
| T1 | Drizzle adapters categorization + currencies + usage | S1 | worker | done | RED 29 → GREEN 29/29 integración real; prisma intacto |
| T2 | DrizzleWorkspaceAdapter (context + settings) | S1 | worker | done | incluido en los 29 tests de T1 (resolve-or-create, provisioners, preferences) |
| T3 | Hono routes categories/currencies/workspace + specs | S2 | worker | done | RED 34 → GREEN 55/55 src/hono; typecheck+depcruise limpios |
| T4 | `src/hono/composition.ts` buildApp(env) + e2e helpers port + e2e verde | S3 | parent | done | **95 e2e verde contra Hono+Drizzle real** (suite 427/427); specs solo tocaron helpers+fixture |
| T5 | Migraciones drizzle-kit (baseline + push para dev) + seed.ts port | S4 | parent | done | `push` drift cero; `migrate` en DB fresca crea 6 tablas+15 índices; seed drizzle OK |
| T6 | Borrar Nest/Prisma (src + deps + prisma/) + main.hono.ts→main.ts + scripts | S4 | parent | done | 420/420 verde; lint+typecheck+depcruise limpios; smoke E2E OK; 8 deps eliminadas |
| T7 | docs/02 + desviaciones + cierre ODD + espejo Engram | S5, S6 | parent | in-progress | |

## Log

- **L9**: "1" — el usuario elige migración completa tras la evidencia del spike.
- **L10**: Tamaño medido: persistencia restante = 5 adaptadores (categorization ×2,
  currencies ×2, workspace ×1); HTTP restante = 3 controllers (categories,
  currencies, workspace); e2e = 95 tests que solo tocan `prisma` en 3 puntos
  (disconnect ×4, 1 fixture de categoría) → port casi gratis.
- **L11**: Decisión de migraciones: `drizzle-kit generate` produce baseline;
  la DB de dev existente se sincroniza con `drizzle-kit push` (no-op porque el
  schema drizzle espeja las tablas exactas); DBs nuevas/CI usan
  `drizzle-kit migrate`. El historial prisma/migrations queda en git.
- **L12**: Decisión de composición: `src/hono/composition.ts` exporta
  `buildApp(env)` → `{ app, close }` reutilizado por `main.hono.ts` y por
  `e2e-helpers.bootApp`, para que los e2e corran el mismo wiring real.
- **L13**: T3 completada (worker): routes categories (11 specs), currencies (15, incl. `/catalog` ISO y CONFLICT_CODES→409), workspace (8, projection + solo 404/400). `createApp` registra los 5 grupos. Hallazgo e2e del worker: ningún spec asserta el orden auth-vs-validación → la desviación 401-first queda aceptada y documentada (S6).
- **L14**: Follow-up T3: worker B amplió `HonoDeps` y rompió typecheck en 4 call sites; padre aprobó solo los 3 specs (main.hono.ts se reescribe en T4, no vale cablearlo con Prisma). 55/55 verde, typecheck limpio salvo main.hono.ts (esperado).
- **L15**: T1/T2 completadas (worker): 5 adaptadores portados método por método; desviaciones vs Prisma documentadas por el worker: `updatedAt` explícito (Prisma @updatedAt era client-side), ids randomUUID (no hay default uuid() en la columna), updatePreferences en workspace inexistente lanza Error plano vs P2025 (ambos 500), `createWorkspace` conserva el quirk de tragar fallo del provisioner.
- **L16**: T4 completada: `buildApp(env)` → `{app, db, close}`; `main.hono.ts` slim; `e2e-helpers` portado (serve + drizzle para fixtures); los 95 e2e pasan SIN tocar assertions — paridad total de comportamiento HTTP+DB.
- **L17**: T5 completada: 3 fixes de fidelidad en `schema.ts` descubiertos por `drizzle-kit push`: `.default(0n)` BigInt no serializa en snapshot → `sql`0``; `.unique()` genera CONSTRAINT y Prisma creó UNIQUE INDEX → `uniqueIndex` con nombre exacto; FKs de Prisma llevan `ON UPDATE CASCADE` → `foreignKey` con nombre `_fkey` + onUpdate cascade. `push` resultante: cero diffs de schema (solo quiere borrar `_prisma_migrations`, legacy que se elimina en T6). `migrate` verificado en DB descartable: 6 tablas + 15 índices.
- **L18**: T6 completada: borrados 21 archivos (composition/, controllers ×6, prisma-* ×9, deterministic adapter, mapper, prisma/ entera con schema+migrations+seed); `main.hono.ts`→`main.ts`; scripts `db:generate`/`db:migrate`/`db:push`/`db:seed` sobre drizzle-kit; deps eliminadas (@nestjs/*, @prisma/client, prisma, reflect-metadata, rxjs, @types/express); `_prisma_migrations` dropeada; smoke test OK (income creado sobre cuenta previa = continuidad de datos entre stacks sobre la misma base).
