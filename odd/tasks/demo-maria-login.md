# Feature: Demo login "María" — entrada demo + reset de semilla al login

Botón "Probar demo" en el LoginPage. Al iniciar sesión demo, el backend re-siembra el workspace `local|demo-maria` (restaura el dataset original) y la web opera como `demo-maria`; los cambios de la sesión se descartan en el próximo login demo.

## Specs

- S1 (L1): "Primeramente como un usuario va a probar la app, tiene que haber una opcion para ingresar con el usuario demo" → LoginPage muestra una entrada demo visible junto a Google/Facebook/email.
- S2 (L1/L2): "La semilla se restaura cuando el usuario inicie sesion" → cada login demo re-siembra `local|demo-maria` ANTES de que la web opere (misma lógica que `pnpm db:seed:demo`).
- S3 (L1): "los cambios se guardaran en local storage" → la sesión demo es client-side (flag + `x-dev-user: demo-maria`); al salir se limpian caches locales igual que el signOut normal.
- S4: el reset es solo para el workspace demo y no puede afectar otros workspaces ni estar disponible fuera del modo dev (misma política que `x-dev-user`, fail-closed).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | API: `seedDemoWorkspace(db)` extraído a `seed-demo-workspace.ts` (una sola tx) + `POST /api/v1/demo/reset` montado solo en AUTH_MODE=dev | S2,S4 | worker | done | RED→GREEN: demo.spec.ts 37/37, composition.spec.ts, app.spec.ts 14/14; curl vivo: {seeded:true, 10/137/11} |
| T2 | Web: botón "Probar con datos de María" en LoginPage → reset → flag `demo-session` + `x-dev-user: demo-maria`; logout demo limpia caches sin Supabase | S1,S3 | worker | done | RED→GREEN: 82/82 specs tocados; suite completa 385/385 |
| T3 | i18n (es/en) + specs + README api | S1-S4 | inline | done | Etiqueta corregida a "Probar con datos de María" (L3); LoginPage.spec 10/10 |

## Log

- L1: "cuando pruebo con \"pnpm dev\", no muestra la opcion para ingresar con el usuario demo Maria" + "Primeramente como un usuario va a probar la app, tiene que haber una opcion para ingresar con el usuario demo, por lo que esto no puede estar como post-MVP. La semilla se restaura cuando el usuario inicie sesion"
- L2 (previo, demo-maria-seed): "los cambios se guardaran en local storage, cada vez que se inicie este perfil se cargaran los datos sinteticos, descartando los cambios."
- L3: "no sino un boton \"Probar con datos de Maria\"" — etiqueta del botón corregida (es: "Probar con datos de María", en: "Try with María's data"); spec actualizado.
