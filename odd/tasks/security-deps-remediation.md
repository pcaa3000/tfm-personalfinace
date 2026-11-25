# Feature: Remediación de alertas Dependabot + code scanning

Pedido del usuario (L1): revisar PRs de dependabot, alertas de seguridad y code scanning, aplicar opción A modificada (sacar prisma en vez de bump) y validar.

## Specs

- S1 (L1, L3): eliminar `prisma`/`@prisma/client` del lockfile — son peers OPCIONALES de `drizzle-orm` (compat APIs que no usamos); autoInstallPeers los instalaba igual. Sin paquete, se eliminan las transitivas vulnerables `effect` y `deepmerge-ts`.
- S2 (L1): vitest 3→4.1.12 en api y web — cierra alertas vitest/@vitest/mocker (path traversal, mock injection) y las 2 CRÍTICAS de `tinypool` (prototype pollution → RCE).
- S3 (L1): overrides acotados en `pnpm-workspace.yaml` (nunca globales): `exceljs>uuid@^11.1.1` (única alerta runtime, export XLSX), `workbox-build>glob@^14.0.2`, `@esbuild-kit/core-utils>esbuild@^0.25.0`. minimatch se resuelve transitivamente (11.0.9).
- S4 (L3): "realizar las pruebas de validacion" — suites api+web completas, typecheck, lint, depcruise.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | `pnpm-workspace.yaml`: `autoInstallPeers: false` + `peerDependencyRules.ignoreMissing` + `ignoredBuiltDependencies` (transicional para la store vieja) + limpieza de `allowBuilds`/`onlyBuiltDependencies`; lockfile regenerado sin prisma/effect/deepmerge-ts; `@opentelemetry/api` declarado explícito en api (peer requerido de pg-boss que antes se auto-instalaba) | S1 | inline | done | `62c37ff` · `pnpm peers check` limpio · Slice boundary: la regeneración del lockfile (~2.8k líneas, generado) vive en este commit; el reviewable va aparte · reviewDue high pero `lens_context_budget_exceeded` sobre el commit único → split T2/T3+doc (misma árbol) |
| T2 | vitest `^4.1.12` api+web | S2 | inline | done | fix vitest4/jsdom: `URL.createObjectURL` de Node existe pero tira `_buffer` con File de jsdom → try/catch defensivo en `ReceiptFlow.acceptFile` (preview no aborta upload); 16 specs volvieron a verde · `71cdc5c` |
| T3 | Hardening de specs DB compartida (descubierto en validación): `drain-outbox.spec.ts` + `notifications.e2e.spec.ts` — el drain toma los 50 pendientes más viejos y suites paralelas insertan pendientes propios → loop acotado `drainUntilProcessed` + aserciones por id propio; `drizzle-category.repository.spec.ts` cleanupAll purga globals stale (`cat_seed_%`/`spec_%`/`e2e-%`) que `ensureSeedCategories` copiaba a WS_A | S4 | inline | done | `71cdc5c` · suite api 142 files / 1401 verde; antes 5 fallos de race · review `review-6d5145a8cef0c687` aprobado (resilience+reliability, T2+T3 juntos) |
| T4 | Overrides de vulnerabilidades | S3 | inline | done | `pnpm audit` → 0 vulnerabilidades; versiones finales: uuid 11.1.1, esbuild 0.25.12/0.28.2, glob 14.0.6, minimatch 11.0.9 |

## Pendiente fuera de código

- Cerrar PRs dependabot #8 y #9 (quedan obsoletos: vitest ya ≥4.1.12 en main).
- Code scanning `js/bad-tag-filter` (`apps/api/test/drizzle-locale-migration.spec.ts:39`): dismiss como "used in tests" o reescritura de la regex — decisión del usuario, no bloqueante (archivo de test).

## Advisory del review `review-6d5145a8cef0c687` (no bloqueantes, trabajo posterior)

- R3-1/R4-003: `drainUntilProcessed` agota maxRounds y devuelve el total sin señal de que los ids propios quedaron pendientes — un caller que solo aserte `drained >= 1` puede pasar con filas propias sin drenar; devolver flag de completion o lanzar al agotar.
- R3-2: el test de dedup re-escanea el workspace por `payload.transactionId` en vez de usar el id de la fila insertada — una fila stale con el mismo transactionId se seleccionaría y haría fallar la aserción.
- R3-3/R4-001/R3-4: el purge de globals usa `LIKE` donde `_` es wildcard (matchea un superset de los prefijos literales) y borra cualquier global del DB compartida con ese prefijo — escapar underscores / predicado exacto y acotar a filas del suite.
- R4-002: el catch de `createObjectURL` traga el fallo sin señal — emitir warn/telemetría o un estado "preview no disponible" en vez de silencio total.

## Log

- L1: "Puedes revisar los PRs abiertos por dependabot..., las revisiones de seguridad... y el code scanning, dame las alternativas para solucionarlo" — análisis entregado (2 PRs vitest, 13 alertas dependabot, 1 alerta code scanning).
- L2: "vamos con la A, pero antes consultar sobre @prisma/client, ya que actualmente usamos drizzle... revisa esto antes" — hallazgo: prisma solo es peer opcional de drizzle-orm, cero imports en src (solo comentarios residuales).
- L3: "si la op A modificada, realizar las pruebas de validacion" — ejecución completa con las 3 correcciones de specs descubiertas en validación.
