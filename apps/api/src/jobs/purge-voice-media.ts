import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { DrizzleDb } from "../drizzle/db.js";
import { voiceNotes } from "../drizzle/schema.js";
import type { Clock } from "../modules/ledger/index.js";
import type { VoiceStoragePort } from "../modules/voices/index.js";

/** Batch cap per run — same bounded-batch policy as receipts (S4). */
export const VOICE_PURGE_BATCH_SIZE = 100;

export interface PurgeVoiceMediaDeps {
  readonly db: DrizzleDb;
  readonly storage: VoiceStoragePort;
  readonly clock: Clock;
}

/**
 * Voice-note half of the daily media purge (voice-drafts T6, S7 —
 * "la purga debe cubrir `voices_voice_notes` igual que
 * `receipts_receipt_scans`"): mirrors `purgeExpiredReceiptMedia`
 * verbatim over the sibling table and runs on the SAME scheduled
 * queue (`receipt-media-purge`, worker.ts) — the shared storage
 * instance serves both modules and every row carries its own
 * storageKey, so no queue or driver split is needed.
 *
 * Deletes the storage object of every note whose media expired
 * (`expiresAt <= now`) and is still present (`mediaDeletedAt IS
 * NULL`), then stamps the marker — the note row, its transcript and
 * its transaction survive (same retention semantics as CA-012).
 * Idempotent — storage drivers tolerate absent objects and
 * already-marked rows are never selected. A per-item storage failure
 * is logged, leaves the row unmarked for the next run and does not
 * abort the batch.
 */
export async function purgeExpiredVoiceMedia(
  deps: PurgeVoiceMediaDeps,
  limit = VOICE_PURGE_BATCH_SIZE,
): Promise<number> {
  const now = deps.clock.now();
  const expired = await deps.db
    .select({ id: voiceNotes.id, storageKey: voiceNotes.storageKey })
    .from(voiceNotes)
    .where(
      and(
        lte(voiceNotes.expiresAt, now),
        isNull(voiceNotes.mediaDeletedAt),
      ),
    )
    .orderBy(asc(voiceNotes.expiresAt))
    .limit(limit);

  let purged = 0;
  for (const row of expired) {
    try {
      await deps.storage.delete(row.storageKey);
    } catch (cause) {
      console.error(
        `[voice-media-purge] failed to delete ${row.storageKey} for note ${row.id}:`,
        cause,
      );
      continue;
    }
    // Guard the update: a concurrent marker or a second worker may
    // have marked the row meanwhile — never overwrite it.
    await deps.db
      .update(voiceNotes)
      .set({ mediaDeletedAt: now, updatedAt: now })
      .where(
        and(eq(voiceNotes.id, row.id), isNull(voiceNotes.mediaDeletedAt)),
      );
    purged += 1;
  }
  return purged;
}
