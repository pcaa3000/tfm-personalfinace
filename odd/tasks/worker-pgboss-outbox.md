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
| T6 | RDD review slice outbox: fix idempotencia consumidor (R3-001/R4-1) | S2 | inline | done | `62a2c71` · receipt `review-3b527839184d9e77` approved (9 advisories, 0 blocking) |
| T7 | RDD review slice `1742b8e..HEAD`: fix legacy in-flight jobs sin `outboxEventId` (R3-001 deploy window) | S2 | inline | done | `d9c6744` · receipt `review-0e765bad3f2dbac7` approved (2 advisories, 0 blocking) |

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
- **T6** (2026-11-07): RDD review nativa del slice outbox (candidate
  `b9ea7b0..8c55682`, worktree `/tmp/tfm-outbox-review`, tier medium, lentes
  resilience/readability/reliability). 2 hallazgos CRITICAL confirmed por
  refuter: **R3-001** (consumidor inserta sin dedup → duplicados con
  redelivery) y **R4-1** (drain en una sola tx: rollback de `processedAt`
  con jobs ya encolados → re-drain reenvía → `randomUUID()` por entrega →
  notificaciones duplicadas visibles). Fix bounded (`62a2c71`, 44 líneas de
  diff): job envuelve `outboxEventId` (id estable de la fila outbox) y el
  consumidor hace `insert…onConflictDoNothing()` con ese id. TDD: RED
  2/4 → GREEN 4/4 focales, **469/469 api**, typecheck + eslint + depcruise
  limpios. Targeted validator aprobó; receipt `review-3b527839184d9e77`
  **approved** (9 advisories informationales: R2-1..R2-4, R3-002..R3-006;
  0 blocking; autoridad quemada, delivery a política normal de repo).
  Lección: el at-least-once prometido en el comentario del drain solo era
  cierto si el consumidor deduplicaba; la identidad estable del evento debe
  viajar en el job, no generarse en el consumidor.

- **T7** done (2026-11-08): el slice review `1742b8e..HEAD` (el rango cubre también
  T28/T29 del ledger; el receipt ampara la slice entera) encontró 1 CRITICAL en el
  código outbox, confirmado por refuter: **R3-001** — los jobs in-flight en pg-boss
  encolados por el drain pre-fix no llevan `outboxEventId`; el consumidor nuevo
  pasaba `id: undefined` → fallo de insert NOT NULL durante la ventana de deploy
  one-time (y los reintentos de pg-boss revivían las duplicaciones). Fix TDD
  `d9c6744` (3 files, 40 líneas de diff): `LedgerEventJob.outboxEventId` pasa a
  opcional (`?`) y el consumidor cae a `randomUUID()` solo cuando el campo ausente
  (jobs legacy); los jobs nuevos mantienen el id estable de la fila outbox y la
  idempotencia por `onConflictDoNothing()` se conserva. Spec nuevo "handles legacy
  in-flight jobs without outboxEventId (deploy window, R3-001)". RED: 1 fallando
  (NOT NULL) → GREEN: 4/4 focales, **470/470 api**, typecheck + lint + depcruise
  limpios. Targeted validator aprobó; receipt `review-0e765bad3f2dbac7`
  **approved** (2 advisories informativos: R3-002 `TopBar.tsx:227`, R4-1
  `ledger-notifications.ts:24`; 0 blocking; autoridad quemada, delivery a política
  normal de repo). Nota: este R3-001 es distinto del R3-001 de la slice anterior
  (`review-3b527839184d9e77`): aquel era la falta de dedup en el insert; este es la
  ventana de compatibilidad del propio fix.
