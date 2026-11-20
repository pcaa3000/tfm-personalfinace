// Public API of the voices module (voice-drafts: microphone audio →
// quarantine → async LLM transcription/extraction → draft transaction).
// Other modules consume use cases and read models exposed here;
// internal layers (domain/, application/, infrastructure/) are not
// importable.
export {
  VoiceNote,
  VOICE_MEDIA_RETENTION_DAYS,
  VOICE_NOTE_STATUSES,
  VOICE_TERMINAL_STATUSES,
  type QuarantineVoiceNoteInput,
  type VoiceNoteState,
  type VoiceNoteStatus,
} from "./domain/voice-note.js";
export {
  extensionForMime,
  sniffVoiceMime,
  validateVoiceUpload,
  VOICE_MAX_BYTES_DEFAULT,
  VOICE_MIME_ALLOWLIST,
  type VoiceMime,
} from "./domain/voice-upload.js";
export {
  VOICE_STORAGE,
  type VoiceStoragePort,
} from "./application/ports/voice-storage.port.js";
export {
  VOICE_NOTE_REPOSITORY,
  type VoiceNoteListPort,
  type VoiceNoteListQuery,
  type VoiceNoteListSlice,
  type VoiceNoteRepositoryPort,
} from "./application/ports/voice-note-repository.port.js";
export {
  decodeVoiceNoteCursor,
  encodeVoiceNoteCursor,
  type VoiceNoteCursor,
} from "./application/voice-note-cursor.js";
export {
  VOICE_DRAFT_DISPATCHER,
  VOICE_DRAFT_QUEUE,
  type VoiceDraftDispatcher,
} from "./application/ports/voice-draft-dispatcher.port.js";
export {
  VOICE_DRAFT_PROCESSOR,
  type VoiceDraftPort,
} from "./application/ports/voice-draft.port.js";
export {
  VOICE_WORKSPACE_CONTEXT,
  type VoiceWorkspaceContext,
  type VoiceWorkspaceContextPort,
} from "./application/ports/voice-workspace-context.port.js";
export type {
  VoiceDraftType,
  VoiceExtraction,
  VoiceExtractionItem,
  VoiceNewCategorySuggestion,
} from "./domain/voice-extraction.js";
export {
  buildVoiceDraft,
  resolveVoiceBusinessDate,
  VOICE_LOW_CONFIDENCE,
  type VoiceDraftContext,
  type VoiceDraftNewCategory,
  type VoiceDraftPayload,
  type VoiceDraftPossibleDuplicate,
  type VoiceDraftSplit,
} from "./domain/voice-draft.js";
export {
  FILE_HASHER,
  type FileHasherPort,
} from "./application/ports/file-hasher.port.js";
export {
  VOICE_FILE_HASH,
  type VoiceFileHashPort,
} from "./application/ports/voice-file-hash.port.js";
export {
  UploadVoiceNoteUseCase,
  type UploadVoiceNoteCommand,
  type VoiceUploadPolicy,
} from "./application/upload-voice-note.use-case.js";
export { GetVoiceNoteUseCase } from "./application/get-voice-note.use-case.js";
export { GetVoiceDraftUseCase } from "./application/get-voice-draft.use-case.js";
export {
  ConfirmVoiceDraftUseCase,
  type ConfirmVoiceDraftCommand,
  type ConfirmVoiceDraftResult,
  type ConfirmVoiceSplitInput,
} from "./application/confirm-voice-draft.use-case.js";
export { RejectVoiceNoteUseCase } from "./application/reject-voice-note.use-case.js";
export { RetryVoiceNoteUseCase } from "./application/retry-voice-note.use-case.js";
export {
  GetVoiceFileUseCase,
  type VoiceFileView,
} from "./application/get-voice-file.use-case.js";
export {
  ListVoiceNotesUseCase,
  type VoiceNoteListPage,
} from "./application/list-voice-notes.use-case.js";
export {
  toVoiceNoteListItem,
  toVoiceNoteView,
  type VoiceNoteListItem,
  type VoiceNoteView,
} from "./application/voice-note.view.js";
export { DrizzleVoiceNoteRepository } from "./infrastructure/drizzle-voice-note.repository.js";
export { DrizzleVoiceWorkspaceContextAdapter } from "./infrastructure/drizzle-voice-workspace-context.adapter.js";
export {
  GeminiVoiceDraftAdapter,
  GEMINI_VOICE_DEFAULT_BASE_URL,
  type GeminiVoiceDraftConfig,
} from "./infrastructure/gemini-voice-draft.adapter.js";
export { PgBossVoiceDraftDispatcher } from "./infrastructure/pgboss-voice-draft.dispatcher.js";
export {
  InlineVoiceDraftDispatcher,
  type InlineVoiceDraftDispatcherOptions,
  type InlineVoiceDraftJob,
  type InlineVoiceDraftRunner,
} from "./infrastructure/inline-voice-draft.dispatcher.js";
