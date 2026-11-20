# Feature: Revisión de tickets cargados y vínculo ticket↔movimiento

El usuario validó el flujo de captura en prod y preguntó dónde se revisan tickets ya cargados y cómo relacionarlos con el movimiento. Hoy no existe UI ni endpoint de lista; el vínculo existe en DB (`ledger_transactions.originRef`, `receipt_scans.transactionId`) pero `TransactionView` descarta `originReference` y nada lo renderiza.

## Specs

- S1 (L26): "En la app, donde se puede revisar los tickets cargados?" — lista de scans del workspace: `GET /api/v1/receipts` devolviendo `{id, status, originalFilename, createdAt, transactionId}` ordenado por `createdAt` desc; pantalla "Tickets" en la web con estado, fecha, archivo y acceso a `GET /receipts/:id/file`.
- S2 (L26): "como podria relacionar el ticket cargado con el registro de movimiento?" — `TransactionView` expone `originReference` (scan id) además de `origin`; el historial de movimientos muestra badge/indicador "ticket" cuando `origin === "ticket"` con link para ver la imagen del scan vía `originReference`.
- S3 (L26, decisión del análisis aceptada en L27): alcance MVP — la lista muestra scans en cualquier estado (`pending|processing|draft_ready|confirmed|rejected|failed`); scans sin confirmar no tienen `transactionId`. No incluye retención/depuración 30d (feature B, doc aparte).

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | API: `ReceiptScanListPort.listByWorkspace` + `GET /api/v1/receipts` (ReceiptScanListItem con transactionId) | S1 | worker mwobvz9s-5 | done | RED→GREEN: 4 spec files RED (404/not-a-function) → 37/37 + e2e 9/9; suite API 745/745; typecheck+lint+depcruise 0 · Risk: none |
| T2 | API: `TransactionView.originReference` expuesto (view + e2e confirm) | S2 | worker mwobvz9s-5 | done | idem T1 — `transaction.view.spec.ts` 2 specs + assert originReference===scanId en e2e · Risk: item 3 (contrato de vista consumido por la web — ampliación aditiva) |
| T3 | Web: `TicketOriginBadge` en `TransactionTable` + `TransactionDayCards` con link a `/receipts/:id/file` | S2 | worker mwobvz9u-6 | done | RED 5 fail → GREEN 64/64; suite web 351/351; typecheck+lint 0 · Risk: none |
| T4 | Web: `TicketsDialog` (lista GET /receipts: filename, fecha, chip de estado, "Ver imagen", chip de transacción vinculada) montado en menú Gestión (TopBar+Sidebar+LedgerPage) | S1+S3 | worker mwobvz9u-6 | done | idem T3 · Risk: none |
| T5 | API: `GET /receipts` con paginación cursor (`?limit&cursor` → `{items, nextCursor}`) | S1+S4 | worker mwodt4uz-b | done | RED 10 fail → GREEN 58/58 focused; suite API 799/799; typecheck+depcruise+lint 0 · Risk: none — keyset (createdAt DESC, id DESC), cursor base64url `{c,i}`, limit inválido→400 INVALID_QUERY, cursor malformado→400 INVALID_CURSOR |
| T6 | Web: `ReceiptImageViewer` autenticado (getReceiptFile→blob→objectURL en Dialog, 410→"medio eliminado", revoke on close) aplicado a TicketsDialog Y TicketOriginBadge (mismo bug 401) | S1 | worker mwodt4v1-c | done | RED 21 fail → GREEN 72/72 focused; suite web 366/366; typecheck+lint 0 · Risk: none |
| T7 | Web: `useInfiniteQuery` + "Cargar más" + filas compactas <600px (≤3 líneas, IconButtons) | S1+S4 | worker mwodt4v1-c | done | idem T6 · Risk: none |

## Log

- L26: "En la app, donde se puede revisar los tickets cargados? como podria relacionar el ticket cargado con el registro de movimiento? se podria gestionar para realizar las depuraciones de 30 dias?"
- L27: "ok, proceder" — se autorizan las dos features propuestas; A primero, retención 30d en doc aparte después.
- Exploración (worker mwob0j4g-4-m0sn): no hay `GET /receipts` lista ni `listByWorkspace`; imagen en `quarantine/<ws>/<scanId>`; storage port sin delete; `originRef`/`transactionId` existen en schema (`schema.ts:123,248`) pero `toTransactionView` omite `originReference`; retención 30d solo documentada (RF-071/RF-075, docs/05).
- Desalineación de contrato cross-worker corregida por el padre: la API emite `extracted` (RECEIPT_SCAN_STATUSES) y la web había tipado `processing` — unión `ReceiptListStatus` + claves i18n es/en renombradas a `extracted`; specs 42/42 + typecheck verdes.
- L28: 'en Tickets cargados, en "Ver imagen" muestra el menseje "{\"code\":\"UNAUTHENTICATED\",\"message\":\"Authentication required\"}". Por otro lado a nivel de UX, que tan bueno es ya que se pueden tener muchos archivos por dia, semana o mes, sobre todo en movil que en 3-5 registros ya ocupa casi toda la pantalla.' — bug: el link abre la URL protegida sin header auth; UX: lista plana sin paginación, filas altas.
- S4 (L28): paginación por cursor en `GET /receipts` + visor de imagen in-app autenticado + filas compactas en móvil.
