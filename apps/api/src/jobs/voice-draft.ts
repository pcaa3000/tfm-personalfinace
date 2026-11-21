import type { CategoryCatalogPort } from "../modules/categorization/index.js";
import type { Clock } from "../modules/ledger/index.js";
import { WorkspaceId } from "../modules/shared-kernel/index.js";
import type {
  VoiceDraftPort,
  VoiceNote,
  VoiceNoteRepositoryPort,
  VoiceStoragePort,
  VoiceWorkspaceContextPort,
} from "../modules/voices/index.js";
import { buildVoiceDraft } from "../modules/voices/domain/voice-draft.js";

/** Job envelope dispatched on the `voice-draft` queue (payload kept minimal). */
export interface VoiceDraftJob {
  readonly voiceNoteId: string;
  readonly workspaceId: string;
}

export interface VoiceDraftJobDeps {
  readonly notes: VoiceNoteRepositoryPort;
  readonly storage: VoiceStoragePort;
  readonly categories: CategoryCatalogPort;
  readonly processor: VoiceDraftPort;
  readonly workspaceContext: VoiceWorkspaceContextPort;
  readonly clock: Clock;
}

/**
 * The workspace business date (S3): `now` rendered as the YYYY-MM-DD
 * day in the workspace timezone. The domain resolves relative hints
 * against this day — it never reads the clock itself.
 */
function businessDay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * T2 consumer (S2+S3+S4+S5+S7): pending note row → storage bytes →
 * workspace context + catalog → single LLM call (transcription +
 * extraction + categorization) → grouped draft → `draft_ready` with
 * the transcript persisted on the row. EVERY failure path marks the
 * row `failed` with its error — the handler never lets an exception
 * escape without persisting a terminal state. Delivery semantics
 * differ per dispatcher (R4-6): pg-boss is at-least-once, so a
 * redelivery of a non-pending row is a no-op; inline dispatch is
 * fire-and-forget with NO redelivery — a crash mid-draft leaves the
 * row `pending` until the user retries via POST /voices/:id/retry.
 */
export async function handleVoiceDraft(
  deps: VoiceDraftJobDeps,
  job: VoiceDraftJob,
): Promise<void> {
  const workspaceId = WorkspaceId.create(job.workspaceId);
  if (!workspaceId.ok) {
    console.error(
      `[voice-draft] invalid workspaceId ${JSON.stringify(job.workspaceId)} for ${job.voiceNoteId}`,
    );
    return;
  }
  // The row load lives INSIDE the try (R3-001/R4-2): a DB failure
  // must never reject out of the handler — every reachable failure
  // persists `failed` so inline dispatch (no redelivery) does not
  // strand the note `pending` forever.
  let note: VoiceNote | null = null;
  try {
    note = await deps.notes.findById(workspaceId.value, job.voiceNoteId);
    if (!note) {
      console.error(`[voice-draft] note not found: ${job.voiceNoteId}`);
      return;
    }
    if (note.status !== "pending") {
      return; // already processed — pg-boss is at-least-once
    }

    const bytes = await deps.storage.open(note.storageKey);
    if (bytes === null) {
      note.markFailed(
        `voice object missing from storage: ${note.storageKey}`,
        deps.clock.now(),
      );
      await deps.notes.save(note);
      return;
    }

    // S3: workspace timezone + default currency must exist before the
    // draft resolves dates/currency — never guessed.
    const context = await deps.workspaceContext.findContext(
      note.workspaceId,
    );
    if (!context) {
      note.markFailed(
        `workspace context missing for ${note.workspaceId.value}`,
        deps.clock.now(),
      );
      await deps.notes.save(note);
      return;
    }

    const categories = await deps.categories.listForWorkspace(
      note.workspaceId,
    );
    const result = await deps.processor.processAudio(
      bytes,
      note.mimeType,
      categories,
    );
    if (!result.ok) {
      note.markFailed(
        `${result.error.code}: ${result.error.message}`,
        deps.clock.now(),
      );
      await deps.notes.save(note);
      return;
    }

    const draft = buildVoiceDraft(result.value, {
      today: businessDay(deps.clock.now(), context.timezone),
      defaultCurrency: context.defaultCurrency,
    });
    note.markDraftReady(
      result.value,
      draft,
      result.value.transcript,
      deps.clock.now(),
    );
    await deps.notes.save(note);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Re-read the persisted row: the in-memory entity may already have
    // advanced (e.g. to draft_ready) while the DB row is still `pending`,
    // so only the stored status is a trustworthy discriminator.
    const persisted = await deps.notes
      .findById(workspaceId.value, job.voiceNoteId)
      .catch(() => null);
    if (persisted === null) {
      // We could neither mark the row nor even re-read it: surface the
      // failure so the dispatcher can redeliver instead of stranding the
      // note `pending` with the job recorded as delivered.
      console.error(
        `[voice-draft] cannot load note ${job.voiceNoteId} to mark it failed: ${message}`,
      );
      throw cause;
    }
    if (persisted.status !== "pending") {
      // R3-003: a transition already committed — logging the failure
      // must never downgrade a committed state back to `failed`.
      console.error(
        `[voice-draft] persist failed for ${job.voiceNoteId} in status ${persisted.status}: ${message}`,
      );
      return;
    }
    try {
      persisted.markFailed(`unexpected: ${message}`, deps.clock.now());
      await deps.notes.save(persisted);
    } catch (saveError) {
      console.error(
        `[voice-draft] failed to persist failed state for ${job.voiceNoteId}:`,
        saveError,
      );
    }
  }
}
