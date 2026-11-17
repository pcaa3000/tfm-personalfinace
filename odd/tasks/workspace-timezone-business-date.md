# Feature: timezone del workspace en fecha de transacciones

La preferencia `workspace.timezone` hoy se persiste pero no influye en el registro
de ingresos/gastos/transferencias: el form envía la zona del navegador y el default
de `businessDate` se calcula en UTC.

## Specs

- S1 (L2): `TransactionForm` envía en `timezone` la zona horaria del workspace recibida por prop; si no hay prop, cae a la del navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`) y luego a `"UTC"`.
- S2 (L2): el default de `businessDate` es "hoy" interpretado en la timezone efectiva (no en UTC); el mismo default aplica tras el reset del formulario.
- S3 (L2): `NewMovementDialog` y `EditTransactionDialog` reciben la timezone del workspace desde `LedgerPage` y la propagan a `TransactionForm`.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | TransactionForm: prop `timezone`, default de fecha en esa zona, submit con esa zona | S1, S2 | worker | done | b4dd021; RED→GREEN 1fail/13pass → 14/14 (spec file); suite apps/web 227/227; tsc + eslint limpios. Nota: spec "submits workspace timezone" pasó por coincidencia en RED (ICU del host = America/Lima); válida pero débil en hosts en esa zona. |
| T2 | Propagar `workspace.timezone` desde LedgerPage a ambos dialogs | S3 | worker | done | b4dd021; mismo commit que T1 (unidad única); GREEN 227/227, tsc + eslint limpios. |

## Log

- L1: «La zona horaria configurada en la parte de preferencias influye en la fecha cuando hago registro de ingresos/gastos/transferencia» — consulta; se verificó que NO influía: `TransactionForm.tsx:169` enviaba la zona del navegador y el default de fecha era `new Date().toISOString().slice(0,10)` (UTC). El backend solo valida que el timezone sea IANA (`BusinessDate.create`).
- L2: «si» — autoriza el cambio propuesto: (1) default de `businessDate` en la timezone del workspace, (2) el form envía `workspace.timezone` con fallback a la del navegador.
- L3: T1+T2 implementadas por gentle-ai-worker (RED observado: default de fecha en UTC; GREEN 14/14 spec file, 227/227 suite, tsc + eslint limpios). Riesgo: none.
