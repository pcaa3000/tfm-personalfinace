import type {
  TransactionDuplicateCriteria,
  TransactionDuplicatesPort,
} from "../../receipts/index.js";
import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type {
  VoiceDraftPayload,
  VoiceDraftPossibleDuplicate,
} from "../domain/voice-draft.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";

/** Semantic dedup window: a dictation ± 3 days around its business date. */
const DUPLICATE_WINDOW_DAYS = 3;

/** Pure UTC calendar-day shift — businessDate strings are TZ-free. */
function shiftIsoDay(isoDate: string, days: number): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Draft read for `GET /api/v1/voices/:id/draft` (voice-drafts T3,
 * S2+S4): returns the stored `draft_payload` — transcript included —
 * the review UI edits; only while the note is `draft_ready`, anything
 * else is a conflict.
 *
 * `possibleDuplicates` is computed HERE, at read time — it is never
 * persisted inside `draft_payload` so the warning always reflects the
 * ledger as it is when the user opens the review (same mechanism as
 * receipts T13/S12, through the shared TransactionDuplicatesPort).
 */
export class GetVoiceDraftUseCase {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly duplicates: TransactionDuplicatesPort,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<VoiceDraftPayload, DomainError>> {
    const note = await this.notes.findById(workspaceId, id);
    if (!note) {
      return err(
        new DomainError("VOICE_NOT_FOUND", `Voice note not found: ${id}`),
      );
    }
    if (note.status !== "draft_ready" || note.draftPayload === null) {
      return err(
        new DomainError(
          "VOICE_NOT_READY",
          `Voice note ${id} is not ready for review (status: ${note.status})`,
        ),
      );
    }
    const draft = note.draftPayload as VoiceDraftPayload;
    return ok({
      ...draft,
      possibleDuplicates: await this.findPossibleDuplicates(
        workspaceId,
        draft,
      ),
    });
  }

  /**
   * Semantic dedup (S4, mirroring receipts T13/S12): same-amount
   * workspace expenses inside the ±3-day window around the draft date
   * OR matching the concept text. The amount is the stated total —
   * falling back to the splits sum when the dictation never stated one
   * (the split sum is exact by construction). No lookup at all when
   * the draft carries no amount or no semantic signal.
   */
  private async findPossibleDuplicates(
    workspaceId: WorkspaceId,
    draft: VoiceDraftPayload,
  ): Promise<VoiceDraftPossibleDuplicate[]> {
    const amountMinorUnits =
      draft.totalMinorUnits ??
      draft.splits.reduce((sum, split) => sum + split.amountMinorUnits, 0);
    if (amountMinorUnits <= 0) {
      return [];
    }
    const merchant = draft.concept?.trim();
    const criteria: TransactionDuplicateCriteria = {
      amountMinorUnits: Math.abs(amountMinorUnits),
      ...(merchant ? { merchant } : {}),
      ...(draft.businessDate
        ? {
            fromDate: shiftIsoDay(
              draft.businessDate,
              -DUPLICATE_WINDOW_DAYS,
            ),
            toDate: shiftIsoDay(
              draft.businessDate,
              DUPLICATE_WINDOW_DAYS,
            ),
          }
        : {}),
    };
    if (!criteria.merchant && !criteria.fromDate) {
      return [];
    }
    return this.duplicates.findExpenseCandidates(workspaceId, criteria);
  }
}
