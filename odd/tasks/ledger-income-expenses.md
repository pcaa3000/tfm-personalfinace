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
| T1 | Corte 1a — Monorepo scaffold + tooling (pnpm workspaces, apps/api NestJS, apps/web React+Vite, vitest, lint, typecheck) + docker-compose PostgreSQL + test de arquitectura | S1, S2, S5 | inline | pending | — |
| T2 | Corte 1b — shared-kernel TDD: Money, CurrencyCode (escala ISO 4217: 0/2/3), BusinessDate (día local + zona IANA), Result | S1, S5 | inline | pending | — |
| T3 | Corte 1c — ledger domain TDD: Transaction (type, amount>0, currency, business date, concept, category, status), TransactionRevision, invariantes INV-TRX-01..05 | S1, S5 | inline | pending | — |
| T4 | Corte 2 — Alta + listado manual vertical: Prisma repo (workspace_id, idempotency key, categorías semilla + "Sin categorizar"), API `/api/v1/transactions` POST/GET con contexto de workspace de servidor (adaptador identidad determinista), web form RHF+Zod+MUI + tabla por moneda | S1, S2, S5, S6 | inline | pending | — |
| T5 | Corte 3 — Edición, anulación y revisiones con trazabilidad | S1, S5 | inline | pending | — |
| T6 | Corte 4 — Supabase Auth OIDC + aislamiento multi-workspace | S1, S5 | inline | pending | — |
| T7 | Corte 5 — PWA offline-first: cola Dexie, "pendiente de sincronización", sync idempotente | S1, S5 | inline | pending | — |

## Log

- L1: "Usando ODD, explora y dame la propuesta mas adecuada para desarrollar la App de Finanzas Personales, como primer punto, la app deberá registrar los ingresos y gastos del usuario. Empezando de lo simple a lo complejo. Dime si tienes dudas."
- L2: "Por ahora empezar con Docker local. Confirmame la arquitectura que usaras, diseño, patrones, TDD, DDD, SOLID, etc. Avisame antes de empezar a implementar codigo."
- L3: "proceder, considerar hacer al menos un commit en cada corte."
- Arquitectura confirmada al usuario: Monolito Modular + Clean/Hexagonal (Ports & Adapters) + Screaming Architecture; DDD (bounded contexts, aggregates, shared kernel); SOLID aplicado (SRP use cases, OCP/LSP puertos sustituibles, ISP puertos segregados, DIP); patrones Repository+DataMapper, Factory methods con invariantes, Result pattern, Unit of Work transaccional, Idempotency key; TDD Red-Green-Refactor con test de arquitectura. No se escribió código hasta confirmación del usuario (L3).
- Engram mirror: topic `odd/ledger-income-expenses/tasks`.
