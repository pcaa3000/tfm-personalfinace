# session-inactivity-logout — Cierre de sesión por inactividad

Cerrar la sesión del usuario tras 10 minutos sin actividad en el cliente web.
Extensión a sesiones normales del requisito demo (docs/01: RNF-020/CA-018).

## Specs

- S1 (L2): con sesión activa, 10 minutos sin actividad del usuario invocan `signOut` automáticamente.
- S2 (L2): cualquier actividad (ratón, teclado, toque, scroll) reinicia el temporizador de 10 minutos.
- S3 (L2): sin sesión (login, bypass, misconfigured) no hay temporizador ni logout automático.
- S4 (implícito de `signOut` existente, GAP-SEC-08): el logout por inactividad usa el mismo `signOut` del contexto, que limpia outbox offline y query cache; si el `signOut` de Supabase falla, la sesión sigue válida y no se destruyen datos.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|-----|------|--------|--------------------|
| T1 | Hook `useInactivityLogout` en AuthProvider + specs | S1–S4 | `apps/web/src/features/auth/use-inactivity-logout.ts`, `auth.tsx`, `inactivity-logout.spec.tsx` | done | 653bf1d — RED→GREEN: 6 fallos/8 → 8/8 specs; suite auth 46/46; typecheck + eslint 0 errores |

## Log

- L1: «Verifica la implementacion del cierre sesion tras 10min de inactividad» → verificado: no implementado; el requisito existe solo acotado a sesión demo (docs/01 RF-083/RF-084/CA-018/RNF-020), modo demo sin implementar.
- L2: «si, implemetar el cierre de la sesion tras 10 min de inactividad» → autorizada implementación para la sesión de usuario normal.
- L3: T1 implementado. Incidencia de autoría en el spec S1: `vi.useFakeTimers()` se instalaba tras el render, así que el timeout inicial quedaba armado con timers reales y no avanzaba; corrección mínima en el spec (un `mousemove` tras instalar fake timers para rearmar bajo el reloj falso). Resto del spec intacto.
- L4: Corrección R1-001 (CRITICAL, review): cada pestaña armaba un timer independiente y solo escuchaba su actividad, así que una pestaña en segundo plano cerraba sesión aunque el usuario estuviera activo en otra. Fix: clave compartida `pf-inactivity-last-activity` en localStorage + listener `storage` que rearma el timer local; la escritura va en try/catch. Spec nuevo RED→GREEN: `storage` event para la clave reinicia los 10 min (9/9 specs). También corregido el spec S1 negativo vacío (R3): rearma con `mousemove` tras `vi.useFakeTimers()` para que la aserción no sea vacua.
