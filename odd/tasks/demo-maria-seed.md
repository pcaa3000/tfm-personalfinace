# Feature: Demo user "María" — synthetic seed dataset

Workspace demo con datos sintéticos realistas de 3 meses móviles (now-90..now), generado por PRNG de semilla fija, insertado vía casos de uso del dominio.

## Specs

- S1 (L1): "se deben generar datos sintenticos de tres meses atras, ej. now()-30, now()-60, now()-90, con esto prodria garantizar que siempre tenga 3 meses de data"
- S2 (L1): "El numero de registros de ingresos/gastos/transferencia deben ser como los haria una persona normalmente."
- S3 (L1): "Los datos de los ingresos puedes ser fijo y/o variables."
- S4 (L2): "los cambios se guardaran en local storage, cada vez que se inicie este perfil se cargaran los datos sinteticos, descartando los cambios." → el seed debe ser reejecutable: re-sembrar descarta el estado previo del workspace demo.
- S5 (L2): "la semilla será fija" → PRNG con seed constante: el dataset es determinista; solo las fechas dependen de now().
- S6 (L2, decisión confirmada): las transacciones se insertan a través de los casos de uso (`CreateAccountUseCase`, `RecordManualTransactionUseCase`) — las invariantes INV-* quedan validadas por construcción.
- S7 (L1/L2): el perfil demo es "Maria"; identidad backend `local|demo-maria` (workspace dedicado, separado de `local|dev-user`).

Post-MVP (fuera de este documento): entrada "probar demo" en la UI de login junto a user/pass y OAuth, y persistencia de cambios de sesión en localStorage (frontend).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Generador sintético determinista: PRNG semilla fija (mulberry32 0x5eed0001), ventana now-89..now, ~120-160 gastos, ~10-14 ingresos (fijos+variables), ~8-12 transferencias | S1,S2,S3,S5 | worker | done | `apps/api/src/drizzle/seed-demo-data.ts`; run live: 10 income / 137 expense / 11 transfer (158). Excepción RED: módulo puro verificado standalone (determinista, dos corridas idénticas) |
| T2 | `seed-demo.ts`: provisiona workspace `local|demo-maria` (`ws-demo-maria`), reset idempotente (borra splits→revisions→transactions→accounts→outbox→notifications del workspace) y siembra cuentas+transacciones vía casos de uso | S4,S6,S7 | worker | done | `apps/api/src/drizzle/seed-demo.ts`; re-run restaura dataset idéntico; saldos: banco 12350.80, efectivo 1390.00, ahorros 13500.00, tarjeta -1072.90 |
| T3 | Script `db:seed:demo` en package.json + nota en `apps/api/README.md` | — | inline | done | `pnpm --filter @tfm/api db:seed:demo` verificado contra Postgres local |

## Log

- L1 (original): "Vamos a explorar la opcion del usuario demo (que podemos llamarala como el usuario demo Maria), se deben generar datos sintenticos de tres meses atras, ej. now()-30, now()-60, now()-90, con esto prodria garantizar que siempre tenga 3 meses de data. El numero de registros de ingresos/gastos/transferencia deben ser como los haria una persona normalmente. Los datos de los ingresos puedes ser fijo y/o variables."
- L2: "1. Para usar la app puedes hacerlo a traves de un user/pass, Auth Google/Facebook o probarlo por el usuario demo "Maria", que tendra los datos sinteticos. Desde este perfil los cambios se guardaran en local storage, cada vez que se inicie este perfil se cargaran los datos sinteticos, descartando los cambios. 2. la semilla será fija 3. puedes explicar mejor este punto" → decisión confirmada: inserción vía casos de uso (Opción B).
- L3 (verificación independiente, Risk item 5): S1-S7 todos cumplidos en vivo; reset confinado al workspace demo (datos no-demo byte-idénticos tras 4 corridas); package.json solo agrega una línea. Advisory aceptado: banda de transferencias corregida a 8-12 (3 payday + 4-8 ATM + 1 tarjeta); la composición varía levemente en los bordes de la ventana móvil (154-158 total), inherente al diseño.
- L4 (review nativa, lineage review-7e8e39a72342af74): aprobada, acknowledge quemado (rev 218a918e). 6 advisory findings non-blocking registrados como follow-ups: conflict target explícito en categorías, exigir DATABASE_URL, envolver reset+seed en una transacción, categorías archivadas abortan re-seed, y tests commiteados para buildDemoPlan (pendiente).
