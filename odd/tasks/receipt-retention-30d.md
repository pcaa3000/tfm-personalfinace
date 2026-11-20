# Feature: Retención fija de 30 días para medios de tickets (y base para audio)

Pedido del usuario (L26): "se podria gestionar para realizar las depuraciones de 30 dias?" — autorizado en L27. Hoy la retención está solo documentada: `docs/01` RF-071/RF-075/RF-077, `docs/05` tabla de retención ("Imagen de ticket u original de audio | 30 días desde la captura | Borrado anticipado disponible sin afectar la transacción confirmada"), `docs/02` `expires_at` fijo 30d, `docs/06` pendiente. No hay `expiresAt`, ni delete en `ReceiptStoragePort`, ni job de purga.

## Specs

- S1 (docs/01 RF-071 literal): "La conservación de tickets y audios debe ser fija y no configurable por encima de 30 días desde la captura" — `receipt_scans` gana `expires_at = createdAt + 30d` (columna persistida, no calculada por request); sin configuración que la extienda.
- S2 (docs/01 RF-075 literal): "Cada ticket o audio debe guardar su expiración calculada a 30 días desde el instante de captura" — la migración backfilles `expires_at` para filas existentes a partir de `createdAt`; el dominio la expone en `ReceiptScanView`/`ReceiptScanListItem`.
- S3 (docs/05 + CA-012 literal): "Borrado anticipado disponible sin afectar la transacción confirmada" — `DELETE /api/v1/receipts/:id/file` borra SOLO el objeto de storage (marca `media_deleted_at`); la transacción confirmada y la fila del scan sobreviven; después de borrado, `GET /receipts/:id/file` devuelve 404/410.
- S4 (L26): depuración automática — job programado (pg-boss schedule diario, consistente con el worker existente) que borra los objetos expirados (`expires_at <= now` y sin `media_deleted_at`) vía `ReceiptStoragePort.delete`; idempotente y tolerante a objetos ya ausentes.
- S5 (docs/01 RF-077 + S1 web): la UI muestra la expiración del medio (pantalla Tickets) y ofrece el borrado anticipado (S3) con confirmación; scans con medio borrado muestran estado correspondiente.

## Tasks

| ID | Corte | S# | Ruta | Estado | Commit / Evidencia |
|----|-------|----|------|--------|--------------------|
| T1 | Migración `0007_absurd_misty_knight` (`expiresAt` NOT NULL backfill + `mediaDeletedAt` nullable), dominio + views | S1+S2 | worker mwoc3psx-7 | done | RED 23 fail/7 files → GREEN 85; suite API 779/779 (suite 780 tras T3b); typecheck+depcruise+lint 0 · Risk: item 1 |
| T2 | `ReceiptStoragePort.delete(key)` — local (ENOENT tolerado) y s3 (SigV4 DELETE, 404 tolerado) | S3+S4 | worker mwoc3psx-7 | done | idem T1 · Risk: item 1 |
| T3 | `DELETE /api/v1/receipts/:id/file` → 204 idempotente + `GET /file` → 410 `RECEIPT_MEDIA_DELETED` | S3 | worker mwoc3psx-7 | done | idem T1 · Risk: item 1 |
| T3b | Fix advisory verify: dedup de scan rechazado con medio borrado re-guarda bytes + `ReceiptScan.restoreMedia` limpia la marca | S3 | worker mwocitkp-a | done | RED 1 fail → GREEN 14/14; suite 780/780 · Risk: item 1 |
| T4 | Job purga diaria `purge-receipt-media` (pg-boss schedule `17 3 * * *` UTC, batch 100, per-item aislado, UPDATE guardado) | S4 | worker mwoc3psx-7 | done | idem T1 · Risk: item 1 |
| T5 | Web: TicketsDialog "Vence: <date>", botón "Eliminar medio" + confirm dialog, estado "Medio eliminado" (chip de transacción intacto, CA-012) | S5 | worker mwoc3psy-8 | done | RED 5 fail → GREEN 47; suite web 356/356; typecheck+lint 0 · Risk: none |

## Log

- L26: "En la app, donde se puede revisar los tickets cargados? como podria relacionar el ticket cargado con el registro de movimiento? se podria gestionar para realizar las depuraciones de 30 dias?"
- L27: "ok, proceder" — autoriza feature A (receipt-review-link, cerrada) y esta feature B.
- Nota de alcance: la retención de audio comparte el plazo (docs/05) pero el canal de voz aún no existe; el mecanismo se diseña sobre `receipt_scans` — reutilizable cuando llegue audio.
- Nota de riesgo: T3/T4 borran objetos de storage → item de riesgo 1 (efectos difíciles de deshacer) ⇒ verificación independiente y cobertura de todos los paths (borrado anticipado, purga, doble borrado).
- Verificación independiente (mwochfum-9): S1–S5 cumplidos, sin blockers; backfill verificado por texto SQL + snapshot (no ejecutado contra DB con filas legacy — la migración se aplica igual en prod donde la tabla tiene filas: orden nullable→UPDATE→SET NOT NULL es seguro). Advisories: (1) re-upload de rechazado con medio borrado no restauraba el objeto → CORREGIDO en T3b; (2) race teórica save() pisa mediaDeletedAt — ventana ínfima, documentado; (3) delete antes de save — si save falla el objeto ya no está pero GET devuelve 410 igual por missing-object, purga reintenta sin daño.
