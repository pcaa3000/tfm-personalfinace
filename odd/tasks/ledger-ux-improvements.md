# Feature: mejoras UI/UX del ledger home

Revisión UI/UX de `LedgerPage` contra el artboard elegido `design/ledger-home/04-hybrid.html`.
El usuario autorizó implementar de la más alta a la más baja prioridad.

## Specs

### Unidad A — estados (alta)
- S1: el estado vacío de movimientos ofrece una acción («Registrá tu primer movimiento» que abre el diálogo de nuevo movimiento), no solo texto. Aplica a tabla (desktop) y day-cards (mobile).
- S2: loading de movimientos muestra `Skeleton` (no texto plano); error muestra mensaje + botón «Reintentar» que refetchea.
- S3: si la query de balance falla o no hay cuentas, el área del strip muestra un estado visible (error con reintento o mensaje de "sin cuentas"), no desaparece en silencio.

### Unidad B — filtros y período (alta)
- S4: en <960px los filtros se presentan compactos/colapsables (patrón chips/expandible del artboard 04 ~L330-360), no 6 TextFields full-size envueltos.
- S5: existen atajos de período («Mes en curso», «Últimos 30 días») que setean el rango de fechas.
- S6: el período activo es visible (topbar o cabecera de sección), no solo deducible por el conteo.
- S7: el campo de búsqueda tiene placeholder localizado («Buscar concepto…»).

### Unidad C — tabla y navegación (media)
- S8: la tabla de transacciones tiene `min-width` (~720px como el artboard) con scroll horizontal en vez de `overflowX: clip`, para no comprimir columnas en 960–1100px.
- S9: las transferencias tienen identidad visual consistente (mismo color en tabla y day-cards, violeta-gris del artboard `--transfer`).
- S10: en 960–1179px la sidebar arranca colapsada (auto-mini, como el artboard ~L690-704) salvo preferencia explícita del usuario; el toggle sigue disponible fuera de ese comportamiento.

### Unidad D — accesibilidad (media/baja)
- S11: el ojo de privacidad sube a target táctil razonable (~34px como los demás IconButtons).
- S12: el theme define `:focus-visible` visible (outline estilo artboard `3px solid var(--focus)`).
- S13: los dots del carrusel tienen área táctil mayor (padding/hit-area ≥ ~24px manteniendo el tamaño visual del indicador).

### Unidad E — fixes de formulario (posterior)
- S14 (L4): el label flotante del primer campo del `TransactionForm` ("Tipo") no queda recortado por el borde superior del `DialogContent` (MUI pone `padding-top: 0` tras `DialogTitle`); el form reserva headroom propio (`pt: 1.5` en el Stack raíz).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Unidad A: estados vacío/loading/error/balance | S1-S3 | worker | done | 1d48f53; RED→GREEN 8fail → 29/29 (3 specs); suite 232/232; tsc+eslint limpios. Riesgo: none. |
| T2 | Unidad B: filtros mobile + atajos + período + placeholder | S4-S7 | worker | done | caa94af; RED→GREEN 10fail/31pass → 41/41; suite 242/242; tsc+eslint limpios. Riesgo: none. |
| T3 | Unidad C: tabla min-width + color transfer + auto-mini rail | S8-S10 | worker | done | cc43724; RED→GREEN 8fail/37pass → 45/45; suite 255/255; tsc+eslint limpios. Ajuste del padre: overflowX:auto solo <1180px para preservar sticky header. Riesgo: none. |
| T4 | Unidad D: target del ojo + focus-visible + dots | S11-S13 | worker | done | e46f39b (S12-S13); S11 aplicado en feat/hide-balance-amounts como fix propio (el ojo vive en esa rama, aún sin mergear). RED→GREEN 3fail/8pass → 11/11; suite 258/258; tsc+eslint limpios. Riesgo: none. |
| T5 | Unidad E: label "Tipo" recortado en diálogos de movimiento | S14 | inline | done | 94c4e1d; RED no aplicable (jsdom no mide layout — fix visual); TransactionForm 20/20 + ReceiptFlow 12/12 verdes; tsc limpio. Riesgo: none. |

## Log

- L1: «puedes revisar la UI/UX y decirme que puedo mejorar» — revisión read-only con skill gentle-ui-design (refs composition-and-feedback + adaptive-interfaces) + exploración de la UI por subagente. Se reportaron 12 hallazgos priorizados.
- L2: «si proceder de la mas alta a la mas baja» — autoriza implementar las mejoras en orden de prioridad.
- L3: T4: el worker detectó que S11 no existía en esta rama (el ojo está en feat/hide-balance-amounts); se aplicó ahí como fix. S12/S13 en e46f39b. Estrategia de entrega: cada unidad T# es un commit/PR propio; la rama supera las ~400 líneas por ser 4 unidades.
- L4: «puedes ajustar el label "Tipo" en el formulario de moviento, que esta cortado.» + confirmación: recorte **visual** (label flotante tapado por el borde del DialogContent, `pt:0` tras DialogTitle). Diagnóstico: el primer campo del form necesita ~9px de aire; fix `pt:1.5` en el Stack raíz de TransactionForm — cubre NewMovementDialog y EditTransactionDialog. T5 registrada en Unidad E.
