# demo-seed-six-months — datos demo a 6 meses, categorías de test fuera del form, seed rápido

Extiende la ventana de datos sintéticos del demo de 3 a 6 meses, saca del listado de categorías las filas sembradas por specs/e2e, ordena la carga (mes actual → resto → depuraciones) y cierra fugas del cascade de borrado demo.

## Specs

- S1 (L3): "explorar la opcion de extender la generacion de los datos sintenticos a 6 meses, ya que los reportes como en gastos evitables, no se refleja como debe ser, por el periodo corto de los datos." → ventana del plan: 180 días; rolling window de meses: actual + 5 anteriores.
- S2 (L4, decisión): "Para los reportes que se tiene actualmente, cual seria el periodo de datos, para que los reportes puedan servir para una toma de datos." → respuesta: 6 meses calendario; la densidad de transacciones se mantiene por-mes (los conteos absolutos actuales escalan ×2 o pasan a por-mes) para que el dataset de 180 días no quede ralo.
- S3 (L5): "descarta datos en categoria como Comida E2E, semilla uno, semilla dos, global spec_globlal_key, que son visibles en el form" → `GET /categories` no devuelve filas sembradas por tests (`e2e-*`, `spec_*`) a workspaces reales/demo; los e2e que las usan las siembran con scope de workspace o las limpian, y existe limpieza de las filas globales ya fugadas.
- S4 (L5): "Optimizar la carga de los datos, cargando el mes actual primero, luego el resto y finalmente las depuraciones, para que el usuario no espere mucho tiempo cuando se carge el perfil demo." → orden del seed async: bootstrap → mes 0 → meses -1..-5 → sweep/depuraciones al final; sin wipe innecesario en workspace nuevo.
- S5 (L5): "cuando se depura el workspace, ya sea al inicio o al cerrar sesion, todos los datos generados en ese workspace se eliminan" → el cascade de borrado cubre todas las tablas con workspaceId, incluidas `voices_voice_notes`, `voices_voice_consents` y `reports_period_closes` (hoy faltan).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | `seed-demo-data.ts`: `WINDOW_DAYS` 90→180, `demoWindowMonths` back ≤5, conteos por-mes (freelance, variables, retiros, pago tarjeta) | S1,S2 | worker | done | RED→GREEN 3→8 specs; plan 167→357 tx deterministas; tsc/eslint/depcruise limpios |
| T2 | Orden de carga en `demo-session-workspaces.ts`: mes actual → -1..-5 → depuraciones al final; skip wipe en workspace nuevo | S4 | worker | done | RED→GREEN 2 fallos→20/20 en DB aislada; wipe condicional `!created`; sweep sigue último |
| T3 | Categorías de test fuera del form: e2e helpers/specs siembran con scope workspace + limpieza de globales fugadas (`e2e-*`, `spec_*`) | S3 | worker | done | RED→GREEN adapter spec 1 fail→6/6; `isTestSeededGlobalCategoryKey` compartido adapter+cleanup; `ensureSeedCategories` filtra globals de test (fix padre); e2e-food pasa a workspace-scoped; `db:cleanup:test-data` borró 8 globales fugadas, 1 skip (referenciada) |
| T4 | Cascade completo: `deleteWorkspacesCascade` + `wipeDemoWorkspaceState` incluyen voice_notes, voice_consents, period_closes | S5 | worker | done | RED→GREEN (leak vn/vc/pc observado→cubierto); 20/20 specs drizzle |

## Log

- L1 (original, demo seed): "se deben generar datos sintenticos de tres meses atras, ej. now()-30, now()-60, now()-90, con esto prodria garantizar que siempre tenga 3 meses de data" (ver `odd/tasks/demo-maria-seed.md` S1 — esta feature la modifica a 6 meses).
- L2: "Puedes explorar la opcion de extender la generacion de los datos sintenticos a 6 meses, ya que los reportes como en gastos evitables, no se refleja como debe ser, por el periodo corto de los datos."
- L3: "Para los reportes que se tiene actualmente, cual seria el periodo de datos, para que los reportes puedan servir para una toma de datos." → análisis: reportes mensuales con comparación al período anterior; 6 meses calendario es el mínimo donde todos funcionan con robustez.
- L4: "Si, ademas descarta datos en categoria como Comida E2E, semilla uno, semilla dos, global spec_globlal_key, que son visibles en el form. Optimizar la carga de los datos, cargando el mes actual primero, luego el resto y finalmente las depuraciones, para que el usuario no espere mucho tiempo cuando se carge el perfil demo. Entiendo que cuando se depura el workspace, ya sea al inicio o al cerrar sesion, todos los datos generados en ese workspace se eliminan."
- L5 (explore): `e2e-food`/`spec_*` son filas globales (`workspaceId NULL`) de `apps/api/test/e2e-helpers.ts:185-210` y `drizzle-category.repository.spec.ts:62-92`; `listForWorkspace` (`drizzle-category-validation.adapter.ts:41-78`) devuelve todo global. Cascade (`demo-session-workspaces.ts:62-95`) omite voice_notes, voice_consents, period_closes. Sweep de huérfanos ya corre último; `demoWindowStart` exportado sin uso.
- L6 (cierre): 3 workers paralelos (superficies disjuntas). Fixes padre post-worker: filtro `isTestSeededGlobalCategoryKey` también en `ensureSeedCategories` (globals de test no se provisionan a workspaces nuevos — flag del worker T3) + spec nuevo; fixtures del spec renombradas `spec_seed_*`→`cat_seed_*`; comentarios "3 months"/"-1, -2" obsoletos actualizados. `pnpm db:cleanup:test-data` borró 8 globales fugadas del dev DB (1 skip por referencia, oculta por el filtro de lectura). Riesgo residual: workspaces existentes con copias owned de claves de test (ej. e2e-food provisionada antes) — el filtro solo oculta globales; limpieza de copias owned queda como follow-up si se observa.
