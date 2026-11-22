# @tfm/api — comandos de desarrollo

Base de datos local (Docker, `docker compose up -d postgres` desde la raíz):

| Comando | Qué hace |
|---------|----------|
| `pnpm db:seed` | Siembra el workspace de desarrollo `local\|dev-user`: moneda PEN y catálogo de categorías (global + copias del workspace). |
| `POST /api/v1/demo/session` | (todos los modos, `caller.sub === DEMO_SUBJECT`) Crea un workspace efímero `kind='demo'` `issuer\|<sub>\|<sid>` y lo siembra async (mes actual → -1 → -2). Devuelve `{sessionId, workspaceId}`. Requests del sujeto demo requieren header `x-demo-session` (fail-closed). |
| `DELETE /api/v1/demo/session` | Borra el workspace del sid (header `x-demo-session`) + workspaces `kind='demo'` con `createdAt` > 24h. 204 idempotente. |
| `pnpm db:demo:cleanup` | Depura workspaces `kind='demo'` huérfanos (>24h) — misma rutina que el sweep de login/logout. |
| `POST /api/v1/demo/refresh` | (todos los modos) Requiere auth y `caller.sub === DEMO_SUBJECT`. Devuelve 202 inmediato y corre async: depura transactions demo fuera de la ventana de 3 meses y genera los meses faltantes (actual, -1, -2) del workspace `<issuer>\|<DEMO_SUBJECT>`. La web lo dispara tras cada login demo. |
| `pnpm db:seed:demo:refresh` | Misma rutina de mantenimiento por CLI (depura + regenera meses faltantes). `DEMO_IDENTITY_KEY`/`DEMO_WORKSPACE_ID` overridables por env. |
| `POST /api/v1/demo/reset` | (solo `AUTH_MODE=dev`) Re-siembra `local\|demo-maria` — el login demo de la web lo llama antes de entrar. Devuelve `{seeded, counts}`. |
| `pnpm db:seed:demo` | Siembra el workspace demo `local\|demo-maria` ("María"): 4 cuentas y ~150 transacciones sintéticas de los últimos 90 días. Es **idempotente**: re-ejecutarlo borra cuentas y transacciones previas del workspace demo y restaura el dataset original (los cambios hechos en la app se descartan). El generador usa PRNG de semilla fija, así el dataset es determinista salvo por las fechas relativas a `now`. Ver `odd/tasks/demo-maria-seed.md`. |
