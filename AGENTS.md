# AGENTS.md — Contrato de trabajo

Este proyecto trabaja con **ODD + TDD estricto**. No es opcional: es la forma de trabajo acordada con el usuario (ver `odd/tasks/ledger-income-expenses.md`, L6/L7/S9). Todo agente o sesión que implemente código DEBE seguir este contrato.

## ODD — Observation/Orchestrated Driven Development

Cada feature tiene un documento en `odd/tasks/<feature>.md` con tres secciones:

- **Specs (`S#`)**: requisitos derivados de instrucciones del usuario o de `docs/`. Cada S# referencia su origen (`L#`, `docs/NN`, decisión confirmada).
- **Tasks (`T#`)**: unidades de trabajo. Columnas: `ID | Corte | S# | Ruta | Estado | Commit / Evidencia`. Estado ∈ {`pending`, `in-progress`, `partial`, `done`, `post-MVP`}.
- **Log (`L#`)**: instrucciones literales del usuario y eventos del proceso, en **orden cronológico estricto**.

### Reglas ODD (innegociables)

1. **El documento se actualiza ANTES o JUNTO al código, nunca post-hoc en lote.** Si cerraste código sin actualizar el doc, eso es un defecto de proceso — ver Remediación.
2. Toda instrucción del usuario se registra como `L#` cuando ocurre.
3. Toda tarea nueva se registra como `T#` con sus `S#` antes de implementar.
4. Al cerrar una `T#`: estado + hash(es) de commit + evidencia (conteo de specs, RED→GREEN, riesgo).
5. El Log se mantiene cronológico (L1, L2, ... en orden; sin huecos ni reordenamientos).
6. **Espejo Engram**: el documento completo se sincroniza al topic `odd/<feature>/tasks` cada vez que se cierra una tarea (no solo al final de la sesión).
7. Trabajo que no encaja en una `T#` existente (ej. localización, fix transversal) **también** recibe `T#`/`S#` propios — nada queda sin tracking.

## TDD estricto

1. **RED observado**: el spec se escribe y se ejecuta ANTES de la implementación; se observa el fallo. Specs e implementación en el mismo batch sin RED observado = defecto de proceso.
2. **GREEN**: implementación mínima que pasa el spec. Se observa verde (conteo de tests).
3. **Refactor**: solo con la suite en verde.
4. La entrada `T#` registra la evidencia: `RED→GREEN` + conteo de specs.

### Remediación cuando ya hay specs + código sin RED observado

Sin reescribir historia:

1. `git checkout <commit-previo-a-la-impl> -- <solo-archivos-de-implementación>` (specs intactos en HEAD).
2. Ejecutar suite → observar RED. Registrarlo.
3. `git checkout HEAD -- <mismos-archivos>` → ejecutar → observar GREEN. Registrarlo.
4. Documentar la corrección en la entrada `T#` con nota honesta de proceso (ver T9 en `odd/tasks/ledger-income-expenses.md`).

## Invariantes de dominio

`docs/04` define `INV-DIN-*`, `INV-TRX-*`, `INV-CTA-*`. Al tocar una invariante: **verificarla en TODOS los paths de mutación** (alta, edición/revisión, anulación, persistencia), no solo el path principal. Lección T8a: `INV-CTA-01`/`INV-CTA-03` se validaban en alta pero no en `Transaction.revise` ni en `PATCH /transactions/:id`.

## Commits

- Un commit por unidad de trabajo, Conventional Commits, **sin atribución IA**.
- El doc ODD se commitea junto al corte o en commit `docs(...)` propio.

## Definition of done por tarea

- [ ] `T#`/`S#`/`L#` registrados antes o junto al código
- [ ] RED observado y registrado
- [ ] GREEN observado con conteo de specs
- [ ] `typecheck` + `lint` + `depcruise` (0 violaciones) + tests verdes
- [ ] `T#` marcada `done` con hash(es) + evidencia; Log cronológico
- [ ] Espejo Engram `odd/<feature>/tasks` sincronizado
- [ ] Invariantes de `docs/04` verificadas en todos los paths de mutación afectados
