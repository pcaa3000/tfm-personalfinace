# Feature: Demo "María" en QA/prod — workspace efímero por sesión

El botón "Probar con datos de María" pide solo el password (email fijo `mariademo@example.com`, usuario Supabase real). Cada sesión del navegador recibe un workspace efímero propio sembrado (`oidc|<demo-sub>|<sid>`); ningún cambio persiste entre sesiones ni dispositivos.

## Specs

- S1 (L1): botón demo pide SOLO el password; el email es fijo `mariademo@example.com` (usuario Supabase creado manualmente por el operador).
- S2 (L1): "todos ven el mismo workspace o perfil" pero "los datos que modifiquen solo es valida para esa sesion del navegador" → cada sesión materializa un workspace efímero sembrado; en otro dispositivo/navegador se carga la semilla original (aislamiento por `sid`).
- S3 (L1): "ningun cambio en la sesion demo es persistente" → los workspaces demo son descartables; un nuevo login demo crea workspace nuevo sembrado.
- S4: `POST /api/v1/demo/session` requiere auth real y `caller.subject === DEMO_SUBJECT` (env); el endpoint existe en TODOS los modos (qa/prod), no solo dev.
- S5: la resolución de workspace del sujeto demo usa `oidc|<sub>|<sid>` cuando la request trae `x-demo-session: <sid>` válido (efímero del sujeto). Sin header válido para el sujeto demo → 401/403 explícito (fail closed), nunca cae al workspace `oidc|<sub>` compartido ni lo crea.
- S6 (L2): "Antes de realizar la publicacion se debe realizar las pruebas en qa" → la feature debe funcionar con `pnpm qa` (AUTH_MODE=oidc + Supabase real).
- S7: el sujeto demo no debe invocar proveedores pagos (receipt-scan OCR / voz); el backend responde con escenario simulado o 403 controlado para `DEMO_SUBJECT`.
- S8: cleanup — al crear una sesión demo nueva, los workspaces demo previos del mismo sujeto se borran; además un sweep por antigüedad (ej. >24h) para sesiones abandonadas.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | API: `POST /demo/session` (auth + DEMO_SUBJECT) crea workspace efímero `oidc|<sub>|<sid>` kind `demo` sembrado; borra workspaces demo previos del sujeto; resolver honra `x-demo-session` fail-closed | S2,S3,S4,S5,S8 | worker | done | RED→GREEN: 149/149 enfocados, suite 746/746; vivo: sid→accounts ok, sin sid→403, subject ajeno→403, sesión nueva mata sid viejo. S8 parcial: sweep por antigüedad queda post-MVP |
| T2 | API: sujeto demo bloqueado en receipt-scan (upload+retry → 403 DEMO_PROVIDER_FORBIDDEN); voices no existe en esta rama | S7 | worker | done | receipts.spec +3; gate a nivel ruta |
| T3 | Web: botón demo → diálogo solo password → signIn email fijo (`VITE_DEMO_EMAIL`, default mariademo@example.com) → POST /demo/session con bearer → sid en sessionStorage → header `x-demo-session` junto a bearer; rollback de sign-in si falla; flag/x-dev-user/pseudo-session eliminados | S1,S2,S3 | worker | done | RED→GREEN: suite web 386/386 |
| T4 | i18n + specs + README + corrida QA (`pnpm qa`) documentada | S6 | inline | pending | i18n/README hechos; QA real pendiente: requiere usuario Supabase mariademo@example.com + DEMO_SUBJECT en env |

## Log

- L1: "primero creo el usuario demo \"mariademo@example.com\" en supabase, y el boton de \"Probar de datos de Maria\", en vez de pedirme el usuario y password, solo me deberia de pedir el pass, teniendo en cuenta el usuaro \"mariademo@example.com\". Si bien todos ven el mismo workspace o perfil, los datos que modifiquen o cambien solo es valida para esa sesion del navegador. En otro dispositivo el usuario cargara una nueva sesion con los datos originales de la semilla, tener en cuenta que ningun cambio en la sesion demo es persistente."
- L2: "Antes de realizar la publicacion se debe realizar las pruebas en qa" — `pnpm qa` corre API con AUTH_MODE=oidc real; el modo actual (x-dev-user + endpoint dev-only) no aplica.
- L3 (verificación en vivo, dev mode): POST /demo/session → sid; GET /accounts + sid → 4 cuentas sembradas; sin sid → 403; subject ajeno → 403; segunda sesión invalida el primer sid (S8 cleanup). Suite api 746/746, web 386/386, typecheck+eslint+depcruise limpios.
