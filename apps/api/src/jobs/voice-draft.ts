import type { CategoryCatalogPort } from "../modules/categorization/index.js";
import type { Clock } from "../modules/ledger/index.js";
import { WorkspaceId } from "../modules/shared-kernel/index.js";
import type {
  VoiceDraftPort,
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
 * escape without persisting a terminal state, and a redelivery of a
 * non-pending row is a no-op (at-least-once idempotence).
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
  const note = await deps.notes.findById(workspaceId.value, job.voiceNoteId);
  if (!note) {
    console.error(`[voice-draft] note not found: ${job.voiceNoteId}`);
    return;
  }
  if (note.status !== "pending") {
    return; // already processed — pg-boss/inline is at-least-once
  }

  try {
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
    try {
      note.markFailed(`unexpected: ${message}`, deps.clock.now());
      await deps.notes.save(note);
    } catch (saveError) {
      console.error(
        `[voice-draft] failed to persist failed state for ${job.voiceNoteId}:`,
        saveError,
      );
    }
  }
}
