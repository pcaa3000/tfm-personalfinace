# Feature: worker pg-boss + outbox transaccional

Infraestructura de jobs asíncronos sobre el stack Drizzle/Hono: eventos de
dominio persistidos en la misma transacción de escritura (outbox), worker
separado que drena a pg-boss, y primer consumidor real (notificaciones).

## Specs

- **S1** (L1, docs/06:155): "Implementar encolado transaccional con pg-boss
  y reconciliación de jobs estancados." El evento se escribe en `outbox_events`
  DENTRO de la transacción de negocio — si el commit falla no hay evento; si
  commita, el evento es durable aunque el proceso muera antes de despachar
  (docs/06:176).
- **S2** (L1): "Infra + primer consumidor" — pipeline end-to-end real:
  `transaction.confirmed|revised|voided` → outbox → drainer → cola pg-boss →
  handler que persiste una fila en `notifications` por evento.
- **S3** (derivado): el consumidor es observable por API:
  `GET /api/v1/notifications` devuelve las notificaciones del workspace,
  `createdAt` descendente.
- **S4** (docs/06:84): worker como proceso separado del API
  (`src/worker.ts`, script `dev:worker`), drenado concurrente-seguro
  (`SELECT … FOR UPDATE SKIP LOCKED`, marca `processedAt`).
- **S5**: dominio y aplicación siguen framework-free — el outbox lo escribe
  el adaptador Drizzle dentro de la tx existente; pg-boss vive solo en
  `src/worker.ts` e infraestructura.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Schema `outbox_events` + `notifications` + migración drizzle | S1, S4 | inline | done | `jobs_outbox_events` + `notifications_notifications` (migración `0002`) · spec information_schema RED→GREEN |
| T2 | `insertOutboxEvent(tx,…)` + emisión en `DrizzleTransactionRepository.save` (confirmed/revised/voided) | S1, S5 | inline | done | 2 specs integración: fila outbox por save, tipos por estado |
| T3 | `src/worker.ts`: drainer SKIP LOCKED → `boss.send` + `boss.work` handler → `notifications` + scripts | S2, S4 | inline | done | specs drain+consumer + smoke pg-boss real E2E (~4s) |
| T4 | `GET /api/v1/notifications` (puerto + use case + adapter + route) | S3 | inline | done | módulo `notifications` + route; 4 specs |
| T5 | Spec pipeline E2E + docs/06 + espejo Engram + cierre | S2 | inline | done | e2e `notifications.e2e.spec` + docs/02 jobs + 456 api verdes |

## Log

- **L1** (2026-11-07): "ok proceder en ese orden hasta antes de la T6" +
  decisión "Infra + primer consumidor" — se abre la feature de jobs asíncronos
  postergada desde el roadmap fase 2.

- **L2** (2026-11-07): incidente journal — `drizzle-kit migrate` en la DB dev
  fallaba en silencio (exit 1, sin error) porque `drizzle.__drizzle_migrations`
  estaba vacía y reaplicaba 0000 sobre tablas existentes. Resolución: migrar en
  DB limpia (`drizzle_kit_probe`), copiar los 3 hashes del journal a dev.
  Lección: `migrate` exige journal consistente; aplicar SQL a mano desincroniza.
- **T1** done: tablas `jobs_outbox_events` (payload jsonb, `processedAt`
  nullable = pending marker) + `notifications_notifications`; migración
  `0002_smiling_sunfire.sql` generada y aplicada; spec `outbox.schema.spec`
  valida columnas vía information_schema. RED→GREEN observado.
- **T2** done: `src/drizzle/outbox.ts` `insertOutboxEvent(tx, event)` +
  emisión en `save()`: `voided→transaction.voided`, `revisions>0→revised`,
  else `confirmed`; payload `{transactionId,type,concept,amount,currency,
  businessDate}`. `cleanE2eData` limpia outbox+notifications. 448 api verdes.
- **T3** done: `src/jobs/drain-outbox.ts` (`drainOutboxOnce`: SELECT FOR UPDATE
  SKIP LOCKED → dispatcher.send → marca processedAt, at-least-once),
  `src/jobs/ledger-notifications.ts` (handler → fila notifications con título
  ES por tipo), `src/worker.ts` (PgBoss + createQueue + work + interval drain
  + graceful shutdown), scripts `dev:worker`/`worker`, dep `pg-boss@12.38.1`.
  Smoke real: worker vivo + POST transaction → `GET /notifications` devolvió
  "Movimiento registrado · smoke worker 999.00 PEN" en ~4s. Datos smoke
  limpiados. Risk: item 5 (nuevo proceso + dependencia de cola).
- **T4** done: módulo `notifications` (puerto `NotificationRepositoryPort`,
  `ListNotificationsUseCase`, `DrizzleNotificationRepository` desc por
  createdAt) + `GET /api/v1/notifications`; `listNotifications` agregado a
  HonoDeps + makeDeps de specs. 455 api verdes.
- **T5** done: `test/notifications.e2e.spec.ts` — tx por API → drainOutboxOnce
  con dispatcher fake → handleLedgerEvent → GET /notifications. Suite:
  **456 api verdes**, typecheck + eslint + depcruise (0 violaciones).
  docs/02 actualizado (worker proceso separado + sección Jobs asíncronos).
