# Feature: Reportes mensuales — flujo de caja, categorías, gastos hormiga, ahorro

Generación de reportes por moneda y período según docs/04, con cierre mensual mínimo y columna `merchant` normalizada. API + página web.

## Specs

- **S1** (L1, RF-050, INV-DIN-06, CA-006): Reporte de flujo de caja **por cuenta y por moneda** para un período: ingresos, gastos, transferencias entrantes/salientes y flujo neto, solo transacciones confirmadas y no anuladas (INV-TRX-01). Nunca totales combinados entre monedas.
- **S2** (L1, RF-051, docs/04 "Otros reportes"): Reporte de gastos por categoría por moneda/período. Desglosa `ledger_transaction_splits` cuando existen (INV-TRX-SPLIT-01); sin splits usa `categoryId` del head. Incluye naturaleza (essential/discretionary/obligation), importe, % del gasto total y conteo; `Sin categorizar` como grupo propio.
- **S3** (L1, docs/04:472-519, CA-010, RN-010, RN-011): Detección de gastos hormiga sobre el período **cerrado** (o provisional): elegibles = confirmadas, no anuladas, misma moneda, naturaleza discrecional. Agrupación por **merchant normalizado** (fallback categoría si merchant NULL). Candidato si simultáneamente: ≥3 operaciones en 30 días; importe medio ≤1% de ingresos del período (o límite absoluto por moneda si no hay ingreso); suma ≥1% del gasto discrecional. Resultado: merchant/categoría, nº ops, total, promedio, frecuencia, % del gasto discrecional, ids de transacciones incluidas (INV-HOR-05). Un gasto aislado pequeño no activa el insight (CA-010).
- **S4** (L1, RF-050, CA-008): Reporte de ahorro del mes por moneda: **tasa observada** = (ingresos−gastos)/ingresos e importe ahorrado = ingresos−gastos. Cero ingresos → sin división por cero, reporte disponible. Gastos ≥ ingresos → déficit visible, ahorro 0% con explicación. Tasa **recomendada** queda fuera de esta feature (requiere política completa).
- **S5** (L4, docs/04 "Cierre mensual"): Cierre mensual mínimo por workspace+moneda+período: tabla de cierres con declaración de integridad y fecha; solo meses calendario terminados en la tz del workspace pueden cerrarse. El mes en curso usa **cierre provisional**: ventana de últimos 30 días, marcado `provisional`, sin recomendación. Una revisión/anulación posterior marca el cierre como desactualizado (no se reescribe).
- **S6** (L3, decisión Opción B): Nueva columna `merchant` (normalizada, nullable) en `ledger_transactions`: poblada desde `receiptScans.draftPayload.merchant` al confirmar tickets, y por normalización de `concept` en alta manual (lowercase, trim, sin dígitos/puntuación/sufijos societarios). Backfill en migración para datos existentes.
- **S7** (L2, CA-013, RF-052): API + página web de reportes. Todo gráfico o métrica tiene tabla/resumen textual equivalente. Drill-down agregado→transacciones cubierto por `GET /api/v1/transactions` existente (RF-053).
- **S8** (RN-001, INV-TRX-01): Solo transacciones `confirmed` participan en reportes; `voided`, borradores y pendientes de sincronización quedan excluidos de todo agregado.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Columna `merchant` + migración/backfill + poblar en alta manual y confirm de receipts | S6 | api | done | RED→GREEN 163 specs; suite 1233; migración 0010 aplicada |
| T2 | Cierre mensual mínimo: tabla + endpoints + invalidación por revisión/void + provisional 30d | S5 | api | done | RED→GREEN 56 specs foc.; suite 1261; migración 0011 |
| T3 | Endpoint flujo de caja por cuenta+moneda+período | S1, S8 | api | done | RED→GREEN; suite 1300; resolver de período compartido |
| T4 | Endpoint gastos por categoría (splits-aware, naturalezas) | S2, S8 | api | done | RED→GREEN 39 specs nuevos; splits-aware |
| T5 | Endpoint gastos hormiga (política ≥3/30d, medias, provisional o cerrado) | S3, S8 | api | done | RED→GREEN; suite 1330 (2 flakes pre-existentes); hormiga evalúa head categoryId, no splits (desviación anotada) |
| T6 | Endpoint ahorro del mes por moneda (observado, déficit 0%) | S4, S8 | api | done | RED→GREEN; CA-008 deficit+no_income cubiertos |
| T7 | Página web de reportes (4 secciones, tablas, react-query, i18n) | S7 | web | pending | |
| T8 | e2e + sync espejo Engram + cierre doc | todos | api+docs | pending | |

## Log

- **L1** (usuario): "Vamos a explorar la generacion de los reportes, empezando por el reporte de flujo de caja por cuenta, moneda, ademas de reporte de gastos por categoria, un reporte para detectar los gastos hormigas y un reporte que indique lo ahorrado en el mes, en cantidad y porcentaje."
- **L2** (decisión): alcance = API + página web.
- **L3** (decisión): comercio para gastos hormiga = **Opción B**, columna `merchant` normalizada en `ledger_transactions` (descartadas heurística sobre `concept` y solo-categoría).
- **L4** (decisión): implementar cierre mínimo por moneda; mes en curso = provisional sobre últimos 30 días.
- **L9** (proceso): T5+T6 delegadas; hormiga por merchant (fallback categoría), cap absoluto PEN 30/USD·EUR 10 cuando income≤0 → confidence low; ahorro observedRate null en no_income, "0.00"+deficit en CA-008. Desviación aceptada: hormiga usa head categoryId (no splits) — candidata a follow-up. ASSESS medium.
- **L8** (proceso): T3+T4 en un worker; `resolve-report-period` compartido (mes en curso → provisional últimos 30d; mes cerrado → closed; sin cierre → provisional mes completo). ASSESS medium.
- **L7** (proceso): T2 delegada; módulo `reports` creado (`reports_period_closes`, índice único parcial activo); invalidación por revise/void vía `PeriodCloseInvalidationPort` opcional en ledger; provisional queda computado (no persistido) para T3-T6. ASSESS medium → sin verifier.
- **L6** (proceso): T1 delegada a worker; ASSESS medium → self-verification, sin verifier; spec journal-head de voice-consents ajustada a "contiene 0009" (fix inline del padre).
- **L5** (exploración): no existe nada de reports/insights/snapshots en código; `ledger_transaction_splits` existe y gobierna el reporte por categoría; "Sin categorizar" usa `nature="uncategorized"` fuera de CategoryNature; `GET /api/v1/transactions` ya filtra by from/to/type/currency/category.
