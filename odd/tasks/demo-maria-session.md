# Feature: Demo "María" en QA/prod — workspace único + mantenimiento de 3 meses

El botón "Probar con datos de María" pide solo el password (email fijo desde `VITE_DEMO_EMAIL`). El usuario demo es un usuario Supabase real (uid `378756d8-bcde-4ad7-ab52-3045d27f9cef`, `mariademo@example.com`); su workspace `<issuer>|<uid>` se pre-siembra y en cada login se refresca async: se garantiza data del mes actual, mes-1 y mes-2, y se depura lo anterior.

## Specs

- S1 (L4): botón demo visible SOLO si `VITE_DEMO_EMAIL` tiene valor; si está vacía el botón se oculta/deshabilita. Pide solo password; sign-in real con ese email.
- S2 (L4): workspace demo = `<issuer>|<demo-uid>` (oidc: `<OIDC_ISSUER>|378756d8-bcde-4ad7-ab52-3045d27f9cef`; dev: `local|demo-maria`, ya existente). Se siembra categorías+currencies+accounts por el path normal.
- S3 (L4): mantenimiento demo — verificar que existan transactions en el mes actual; si no, generarlas (async, "por debajo"). Ídem mes-1 y mes-2. Purga data demo más vieja que la ventana de 3 meses.
- S4 (L4): script pnpm (`db:seed:demo:refresh` o similar) que depura data demo dejando los últimos 3 meses y/o regenera lo faltante. Reusa la misma rutina que el endpoint.
- S5 (L4): en cada login demo la web llama al endpoint de refresh (fire-and-forget async tras el sign-in) — la app carga la data existente del usuario demo.
- S6 (L4): "ningun cambio en la sesion demo es persistente" → el refresco por login + el mantenimiento dejan el workspace en su estado semilla; los cambios dentro de una sesión se descartan en el próximo refresh (modelo simplificado: workspace compartido entre sesiones demo concurrentes, explícitamente aceptado por L4 al abandonar el modelo por-sid).
- S7 (previo): el sujeto demo no debe invocar proveedores pagos (gate ya implementado en receipts por `DEMO_SUBJECT`; mantener).
- S8 (L4, revisado): la generación de meses faltantes es async y no bloquea el login; el endpoint devuelve inmediatamente.
- S9 (L2): debe funcionar con `pnpm qa` (oidc real) — requiere `DEMO_SUBJECT=378756d8-bcde-4ad7-ab52-3045d27f9cef` en env del API y `VITE_DEMO_EMAIL` en web.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | REVERTIR modelo por-sid: quitados `/demo/session`, resolver sid, middleware x-demo-session, módulo modules/demo | Simplificación L4 | worker | done | Suite api 848/848 |
| T2 | API: `refreshDemoWorkspace` — advisory lock + bootstrap + purge < mes-2 día 1 + top-up por mes vía `buildDemoPlan(now,{months})`; script `db:seed:demo:refresh` | S2,S3,S4 | worker | done | refresh spec 16/16; live: purged 15 stale tx, 0 generadas |
| T3 | API: `POST /api/v1/demo/refresh` — auth + `caller.subject === DEMO_SUBJECT`, mutex in-process, 202 fire-and-forget | S5,S8 | worker | done | live: demo→202, dev-user→403, sin auth→401, /demo/session→404 |
| T4 | Web: revertido sid completo; botón solo si `VITE_DEMO_EMAIL`; password-only → signIn → refresh fire-and-forget | S1,S5 | worker | done | RED→GREEN: 81/81 enfocados, suite web 384/384 |
| T5 | i18n + specs + README/env docs + nota QA | S9 | inline | done | README actualizado; QA real requiere DEMO_SUBJECT + VITE_DEMO_EMAIL en env | |

## Log

- L1: "primero creo el usuario demo \"mariademo@example.com\" en supabase, y el boton de \"Probar de datos de Maria\", en vez de pedirme el usuario y password, solo me deberia de pedir el pass, teniendo en cuenta el usuaro \"mariademo@example.com\". Si bien todos ven el mismo workspace o perfil, los datos que modifiquen o cambien solo es valida para esa sesion del navegador. En otro dispositivo el usuario cargara una nueva sesion con los datos originales de la semilla, tener en cuenta que ningun cambio en la sesion demo es persistente."
- L2: "Antes de realizar la publicacion se debe realizar las pruebas en qa" — `pnpm qa` corre API con AUTH_MODE=oidc real.
- L3 (modelo por-sid, implementado y verificado): ver commits previos — queda revertido por L4.
- L4 (nueva dirección, reemplaza el modelo por-sid): "Creo que nos estamos complicando, exploremos esta nueva prespectiva. El usuario demo \"Maria\" ha sido creado en supabase su uid es 378756d8-bcde-4ad7-ab52-3045d27f9cef y su email es \"mariademo@example.com\", ese dato nos sirve para crear el workspace en la tabla \"identity_workspace_workspaces\", luego generar las categorias,currencies, accounts, luego verificar que exista data en transactions, primero en el mes actual, si no existe generarlo de acuerdo a la semilla, en modo asincrono y por debajo, verificar que exista data del mes-1, y mes-2, si no existe generar la data en transactions. Ademas generar un script de pnpm, para depurar data demo y dejar los ultimos tres meses y/o actualizar los data para los ulitmos tres meses si fuera necesario. Asi cuando el usuario se logee, con el boton de \"usar datos de usuario demo Maria\", e ingrese el pass, llamara a la data que tiene cargada para ese usuario. El email del usuario demo, que sirve para autenticarse, puede estar en una variable, como userdemo, en .env, si esta esta vacia, el boton para ingresar como usuario demo debe ser deshabilitado y no visible. A partir de este dato, la app sabra que el worksepace de este usuario sera para demo y no persistiran los cambios."
- L5 (verificación live dev): POST /demo/refresh demo→202 async, dev-user→403, unauth→401, /demo/session→404 (revert OK); db:seed:demo:refresh purgó 15 tx viejas y dejó meses poblados; GET /accounts demo (sin sid) → 4 cuentas. Pendiente: QA real con Supabase + DEMO_SUBJECT/VITE_DEMO_EMAIL configurados (S9); workspace `kind='demo'` huérfano del modelo previo quedó en DB dev (dato, no código).
- L6: lineage review-40a8bf2a3a2c9038 (modelo por-sid) quedó escalada y es moot — el candidato cambió por L4.
- L7 (review nativa, lineage review-40737c9d3fb8140e): aprobada, acknowledge quemado (tier high). 10 advisories como follow-ups, destacados: refresh purge no borra outbox/notifications (huérfanos); visitor que archiva/renombra seed account/category hace fallar todo refresh futuro en silencio; hint "se descartan al cerrar sesión" es impreciso (persisten hasta próximo refresh); gate de providers es fail-open si falta DEMO_SUBJECT; refresh sin observabilidad; advisory lock sin test.
- L8 (verificación independiente, Risk item 3 + fix S6): S1-S5,S7,S8 met; verificador detectó S6 no cumplido (top-up no restauraba semilla; cambios de visitante persistían en ventana). Fix aplicado: refresh ahora hace wipe del ledger demo (compartido `wipeDemoWorkspaceState`) + re-seed de la ventana 3 meses → cada login demo restaura estado semilla (descarta cambios previos), y además resuelve los advisories de outbox/notifications huérfanos y el hint engañoso (ahora dice "próximo ingreso a la demo"). Diferencial db:seed:demo byte-idéntico; live: wipe 158 → 143 reinsertadas. Risk 3a/3b/3c met: purge scopeado al workspace demo, orden FK seguro, corrida en vivo OK.
- L9 (review nativa, lineage review-78c214a130fe7bec): correction_required por CRITICAL R3-001 (categoría semilla archivada → todo refresh futuro falla en silencio). Corrección aplicada (commit d196b84): bootstrap ahora restaura categorías semilla en conflicto (un-archive + label/nature) + spec del escenario. Plan 54 líneas dentro del budget 200; validación targeted aprobada; acknowledge quemado (rev af4e16dc). 6 advisories non-blocking quedan como follow-ups (fail-open del provider gate, categorías custom del visitante persisten, lock cross-process sin test, triggers coalesced silenciosos, /demo/reset sin auth en dev).
- L10 (decisión B confirmada + refinamientos): "Al cerrar sesion by logout, solo se borra el workspace de la sesion utilizada? No se puede incluir para que tambien depure los workspace huerfanos. Ademas crear un script en pnpm para depurar los wokspace huerfanos." → modelo final: workspaces efímeros kind='demo' por sid (recuperar modelo revertido), siembra async por meses (actual→-1→-2), depuración de huérfanos kind='demo' createdAt<now()-24h en (a) nueva sesión, (b) DELETE /demo/session en logout, (c) script `pnpm db:demo:cleanup`. Web: sid en sessionStorage + x-demo-session header; refresh/top-up del modelo compartido queda reemplazado.
- L11 (contexto): usuario prefirió sandbox server-side (B) sobre overlay cliente por Clean Architecture — la lógica de proyección no se duplica en la web.

## Tasks (v2 — modelo por-sid restaurado)

| ID | Corte | S# | Estado |
|----|-------|----|--------|
| T6 | API: POST /demo/session → sid + workspace kind='demo' sembrado async (bootstrap + meses 0,-1,-2 en orden); resolver x-demo-session fail-closed; DELETE /demo/session borra sid actual + huérfanos>24h; sweep>24h también en create | S2,S3,S4,S5,S8 | done — 45/45 enfocados, suite 884/884 |
| T7 | API: `cleanupDemoWorkspaces(db)` compartida + script `pnpm db:demo:cleanup` | L10 | done — live: "removed 0 orphan workspaces" |
| T8 | Web: restaurar sid flow (sessionStorage + x-demo-session), DELETE en logout | S1,S3 | done — 88/88 enfocados, suite 391/391 |
- L12 (implementación v2): T6-T8 entregados. POST /demo/session→201 {sessionId,workspaceId} + seed async por meses en orden (cada mes su tx, guard ante mid-seed delete); DELETE /demo/session→204 borra sid + sweep >24h; sweep también al final del seed job; script db:demo:cleanup. Suites: api 884/884, web 391/391.
- L13 (verificación live, dev mode): POST /demo/session → sid; seed async completó (143 tx, 4 cuentas); sin sid → 403; sid erróneo → 403; DELETE → 204; sid post-delete → 403. Sujeto ajeno → 403 (specs). QA con Supabase real pendiente del usuario.
