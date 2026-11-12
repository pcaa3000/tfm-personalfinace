# Feature: offline-pending-visibility — filas pendientes visibles sin conexión

Bug de UX reportado en producción: una transacción creada offline no
aparecía en la tabla de movimientos hasta reconectar — riesgo de
duplicados por re-ingreso manual.

Branch: `feature/offline-pending-visible`
| Espejo Engram: `odd/offline-pending-visibility/tasks`

## Specs

- S1 (L1): una transacción encolada offline aparece inmediatamente en la
  tabla con badge "Pendiente de sincronización", sin esperar reconexión.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | `networkMode: "always"` en `pendingQuery` + spec de regresión | S1 | inline | done | RED observado: fila ausente offline (query pausada) → GREEN 17/17 spec, 218/218 suite web, typecheck+lint limpios |

## Log

- L1 (2026-11-11): "cree la transaccion en ofline, pero esta no se
  mostraba la tabla de movimientos hasta que lo saque del modo avion...
  podria hacer que el usuario duplique transacciones. Como se debe
  abordar para evitarlo" — diagnóstico: la infraestructura de filas
  pendientes (badge `pendingSync`, merge en tabla, edit/void deshabilitado)
  ya existía; la causa raíz era que React Query con `networkMode:"online"`
  default pausa el refetch de `pendingQuery` estando offline aunque su
  queryFn lee IndexedDB local. Fix: `networkMode: "always"` en
  `pendingQuery` (`LedgerPage.tsx`). Spec de regresión: render online →
  `navigator.onLine=false` + evento `offline` → invalidar
  `pending-transactions` → la fila pendiente aparece igual.
