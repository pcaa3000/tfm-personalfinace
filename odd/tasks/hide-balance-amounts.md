# Feature: ocultar saldos (ojo de privacidad) en BalanceStrip

El artboard elegido `design/ledger-home/04-hybrid.html` plantea un ojo de
privacidad por card de moneda que enmascara los montos; no fue implementado.

## Specs

- S1 (L1, design 04-hybrid ~L344/L1116): cada card de moneda del BalanceStrip tiene un botón "ojo" (`aria-pressed`, `aria-label` localizado: «Mostrar montos de …» / «Ocultar montos de …») que alterna enmascarar/revelar los montos de esa card.
- S2 (design 04-hybrid): los montos arrancan **ocultos por defecto**.
- S3 (design 04-hybrid): el estado se persiste en `localStorage` por moneda (en el diseño: `tfm-hide-amounts-cards` indexado por posición; en la app se indexa por código de moneda).
- S4 (design 04-hybrid): al enmascarar se reemplazan los dígitos por `•••` y al revelar se restaura el monto real; el estado nunca muta los datos subyacentes.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Eye toggle por card + máscara ••• + persistencia localStorage + i18n | S1-S4 | worker | pending | |

## Log

- L1: «en los diseños se habia planteado la opcion de ocultar los saldos, pero esto se ha aplicado.» — el usuario reporta que la opción de ocultar saldos del diseño no se aplicó. Verificado: `design/ledger-home/04-hybrid.html` (artboard elegido, handoff implemented) define ojo por card, oculto por defecto, persistido en `tfm-hide-amounts-cards`; `apps/web` no tiene nada equivalente. Se interpreta como pedido de implementarlo.
