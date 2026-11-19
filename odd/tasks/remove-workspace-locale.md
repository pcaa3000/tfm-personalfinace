# Feature: remove workspace `locale` + padded date formats

Removes the unused `locale` workspace preference end-to-end (UI, API, use case, Drizzle schema + migration) and pins ES→`dd/mm/yyyy`, EN→`mm/dd/yyyy` date rendering driven by the UI language.

## Specs

- S1 (L1): quitar `locale` por completo — form de Preferencias, `PATCH /api/v1/workspace`, use case, puertos/adapters, tipos web, i18n (`settings.locale`, `errors.LOCALE_INVALID`), schema Drizzle y **columna `workspaces.locale` con migración** (L2: migración autorizada).
- S2 (L1): con LanguageSwitcher en ES las fechas se muestran `dd/mm/yyyy`; en EN `mm/dd/yyyy` (día y mes con cero a la izquierda). El formato lo sigue determinando `i18n.language`.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
| --- | --- | --- | --- | --- | --- |
| T1 | `format.ts`: padding 2-digit en `formatBusinessDate`/`formatInstant` | S2 | inline | done | RED→GREEN 10 specs (format.spec.ts) · Risk: none |
| T2 | Web: quitar `locale` de PreferencesDialog, api.ts, types.ts, i18n, specs | S1 | worker | done | GREEN 335 specs + tsc (remoción pura, sin RED nuevo) · Risk: item 3 (se cambia contrato `WorkspaceView`/PATCH — cambio pedido) |
| T3 | API: quitar `locale` de route, use case, WorkspaceContext, adapters, schema + migración `drop column`, seed, specs | S1 | worker | done | RED→GREEN 718 api specs + tsc + depcruise + eslint · migración `0006_spooky_luminals.sql` · Risk: items 1 (DROP COLUMN autorizado L2) y 3 (PATCH rechaza `{locale}` con INVALID_BODY) |
| T4 | Docs: actualizar referencias a `locale` como preferencia (docs/01 RF-003/RN-004, docs/03, docs/04, docs/05, docs/06) | S1 | inline | done | Risk: none |

| — | Corte único del feature (rama `feature/remove-workspace-locale`) | S1, S2 | — | done | `9c2f003` |

## Log

- L1 (usuario): «Si locale no tiene ninguna funcionalidad, sería mejor quitarlo. Por otro lado si el formate de fecha lo determina el languageSwitcher, cuando es "ES" el formato fecha deberia ser "dd/mm/yyyy" y cuando es "EN" deberia ser "mm/dd/yyyy"».
- L2 (usuario, decisión): quitar `locale` también de la base — migración que elimina la columna `workspaces.locale`.
- L3 (hallazgo): `locale` se persistía pero ningún consumidor lo leía; el formateo de fechas usa `i18n.language` (tfm-locale) en `format.ts`.
- L4 (proceso): T2/T3 delegados a dos workers con superficies disjuntas (apps/web / apps/api). La tabla física es `identity_workspace_workspaces`. Pendiente: aplicar `db:migrate` en entornos (DROP COLUMN irreversible, autorizado en L2).
- L5 (usuario): la modificación de `apps/api/.env.example` es del usuario; queda fuera del commit del feature (sigue modificada en el árbol).
- L6 (verify): verificador independiente — migración byte-exacta, journal idx 6, snapshot solo pierde `locale`, `drizzle-kit generate` en scratch → "No schema changes"; spec durable `apps/api/test/drizzle-locale-migration.spec.ts` (5/5) incorporada al corte.
- L7 (proceso): corte único `9c2f003` en rama `feature/remove-workspace-locale` (creada desde `feature/receipt-scan-drafts`).
