# Feature: Ledger — registro de ingresos y gastos

Objetivo: primera app funcional que registra ingresos y gastos del usuario, de lo simple a lo complejo.
Branch: `feature/ledger-income-expenses` | Delivery: un commit por corte (mínimo uno por corte, Conventional Commits) | Test runner: `pnpm vitest` (dominio/aplicación) + integración sobre PostgreSQL Docker.

## Specs

- S1 (L1): "la app deberá registrar los ingresos y gastos del usuario. Empezando de lo simple a lo complejo."
- S2 (L2): "Por ahora empezar con Docker local."
- S3 (L2): "Confirmame la arquitectura que usaras, diseño, patrones, TDD, DDD, SOLID, etc. Avisame antes de empezar a implementar codigo."
- S4 (L3): "proceder, considerar hacer al menos un commit en cada corte."
- S5 (docs): La solución sigue la arquitectura ya definida en el repo: monolito modular + Clean Architecture + SOLID (`docs/03`), DDD táctico con invariantes de `docs/04` (INV-DIN-01..04, INV-TRX-01..05), roadmap por cortes verticales (`docs/06` Fases 0 y 1) y stack TS/NestJS/Prisma/PostgreSQL + React/Vite (`docs/02`).
- S6 (decisión confirmada): PostgreSQL en Docker local y adaptador de identidad determinista en los primeros cortes; Supabase Auth llega en el Corte 4.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit |
|----|-------|----|------|--------|--------|
| T1 | Corte 1a — Monorepo scaffold + tooling (pnpm workspaces, apps/api NestJS, apps/web React+Vite, vitest, lint, typecheck) + docker-compose PostgreSQL + test de arquitectura | S1, S2, S5 | inline | done | c4bee38 |
| T2 | Corte 1b — shared-kernel TDD: Money, CurrencyCode (escala ISO 4217: 0/2/3), BusinessDate (día local + zona IANA), Result | S1, S5 | inline | done | 4370889 |
| T3 | Corte 1c — ledger domain TDD: Transaction (type, amount>0, currency, business date, concept, category, status), TransactionRevision, invariantes INV-TRX-01..05 | S1, S5 | inline | done | 09c4f49 |
| T4 | Corte 2 — Alta + listado manual vertical: Prisma repo (workspace_id, idempotency key, categorías semilla + "Sin categorizar"), API `/api/v1/transactions` POST/GET con contexto de workspace de servidor (adaptador identidad determinista), web form RHF+Zod+MUI + tabla por moneda | S1, S2, S5, S6 | inline | done | b66e921 (backend), aca0085 (web + GET /categories) |
| T5 | Corte 3 — Edición, anulación y revisiones con trazabilidad | S1, S5 | inline | done | 756db32 |
| T6 | Corte 4 — Supabase Auth OIDC + aislamiento multi-workspace | S1, S5 | inline | pending | — |
| T7 | Corte 5 — PWA offline-first: cola Dexie, "pendiente de sincronización", sync idempotente | S1, S5 | inline | pending | — |

## Log

- L1: "Usando ODD, explora y dame la propuesta mas adecuada para desarrollar la App de Finanzas Personales, como primer punto, la app deberá registrar los ingresos y gastos del usuario. Empezando de lo simple a lo complejo. Dime si tienes dudas."
- L2: "Por ahora empezar con Docker local. Confirmame la arquitectura que usaras, diseño, patrones, TDD, DDD, SOLID, etc. Avisame antes de empezar a implementar codigo."
- L3: "proceder, considerar hacer al menos un commit en cada corte."
- Arquitectura confirmada al usuario: Monolito Modular + Clean/Hexagonal (Ports & Adapters) + Screaming Architecture; DDD (bounded contexts, aggregates, shared kernel); SOLID aplicado (SRP use cases, OCP/LSP puertos sustituibles, ISP puertos segregados, DIP); patrones Repository+DataMapper, Factory methods con invariantes, Result pattern, Unit of Work transaccional, Idempotency key; TDD Red-Green-Refactor con test de arquitectura. No se escribió código hasta confirmación del usuario (L3).
- Engram mirror: topic `odd/ledger-income-expenses/tasks`.
- T1 done (c4bee38): pnpm monorepo (apps/api NestJS+vitest+dependency-cruiser, apps/web React+Vite), docker-compose Postgres (18 layout), eslint flat, tsc strict. Verificado: typecheck, lint, depcruise 0 violaciones, `pg_isready` OK. Nota: imagen postgres quedó `postgres:alpine` (18.x) — volumen montado en /var/lib/postgresql.
- T2 done: shared-kernel/domain con Result, DomainError, CurrencyCode (tabla ISO 4217 exponentes 0/2/3/4, default 2), Money (bigint minor units, escala por moneda, toDecimalString canónico, mismatch de moneda lanza DomainError), BusinessDate (YYYY-MM-DD + IANA tz). 61 tests verdes; depcruise 0 violaciones.
- T3 done: ledger/domain Transaction aggregate (recordManual crea siempre `confirmed`, INV-TRX-01/05; revise con FieldChange por campo incl. currency como campo propio, INV-TRX-03; void sin borrar historia, INV-TRX-02), TransactionRevision, CategoryAssignment con UNCATEGORIZED explícito (RF-015), WorkspaceId en shared-kernel. 75 tests verdes; depcruise 0 violaciones.
- T4 done: prisma init-ledger (workspace, categories, transactions+revisions, unique (workspaceId,idempotencyKey)); RecordManualTransactionUseCase/ListTransactionsUseCase con puertos repo/categories/clock/ids; DeterministicWorkspaceAdapter (ws-local-dev); GET+POST /api/v1/transactions y GET /api/v1/categories (zod en HTTP); seed catálogo global. Web: LedgerPage+TransactionForm (RHF+Zod+MUI 7)+TransactionTable+summarizeByCurrency. 82 tests (80 api + 2 web). E2E manual verificado: create, replay idempotente (mismo id), list, categories. Gotchas: (a) tsx/esbuild NO emite design:paramtypes → @Inject explícito en todo; (b) @@unique con workspaceId NULL no deduplica globales → seed findFirst+create; (c) pnpm v12 requiere allowBuilds+onlyBuiltDependencies para esbuild/prisma; (d) MUI 7 usa slotProps. Pendiente: tests e2e HTTP automatizados y autorización negativa cross-workspace quedan para Corte 3/4.
- T5 done (756db32): ReviseTransactionUseCase (campos parciales: monto hereda moneda guardada, fecha hereda zona guardada, categoryId null = desategorizar explícito), VoidTransactionUseCase (replay idempotente: ya voided devuelve vista sin nueva revisión), ListTransactionRevisionsUseCase + TransactionRevisionView. HTTP: PATCH /api/v1/transactions/:id, POST /:id/void, GET /:id/revisions (404 via *_NOT_FOUND). Web: TransactionForm reutilizado en modo edición (initialValues + submit deshabilitado si !isDirty), EditTransactionDialog, VoidTransactionDialog con confirmación, TransactionHistoryDialog (react-query lazy), tabla con columna Actions, filas voided atenuadas y contador de revisiones en Status. 94 tests api (14 nuevos) + 2 web; typecheck/lint/depcruise verdes. E2E curl verificado: PATCH→rev#1, void→rev#2, void replay sin duplicar, GET revisions ordenado, PATCH sobre voided→TRANSACTION_ALREADY_VOIDED, PATCH id inexistente→404. Gotcha: MUI 9 Stack no acepta justifyContent como prop directa → sx. Aún pendiente de Corte 3/4: tests e2e HTTP automatizados.
