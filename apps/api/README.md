# @tfm/api — comandos de desarrollo

Base de datos local (Docker, `docker compose up -d postgres` desde la raíz):

| Comando | Qué hace |
|---------|----------|
| `pnpm db:seed` | Siembra el workspace de desarrollo `local\|dev-user`: moneda PEN y catálogo de categorías (global + copias del workspace). |
| `POST /api/v1/demo/reset` | (solo `AUTH_MODE=dev`) Re-siembra `local\|demo-maria` — el login demo de la web lo llama antes de entrar. Devuelve `{seeded, counts}`. |
| `pnpm db:seed:demo` | Siembra el workspace demo `local\|demo-maria` ("María"): 4 cuentas y ~150 transacciones sintéticas de los últimos 90 días. Es **idempotente**: re-ejecutarlo borra cuentas y transacciones previas del workspace demo y restaura el dataset original (los cambios hechos en la app se descartan). El generador usa PRNG de semilla fija, así el dataset es determinista salvo por las fechas relativas a `now`. Ver `odd/tasks/demo-maria-seed.md`. |
