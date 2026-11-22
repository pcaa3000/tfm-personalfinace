import type { CategoryView } from "../../../categorization/index.js";
import type {
  DomainError,
  Result,
} from "../../../shared-kernel/index.js";
import type { VoiceExtraction } from "../../domain/voice-extraction.js";

/**
 * Audio+LLM port (voice-drafts T2, D1, S2+S3+S4): a SINGLE call
 * transcribes the dictation AND extracts the structured draft —
 * transcript + type + items classified against the workspace catalog —
 * so categorization costs the extraction call, nothing more.
 * Implementations (Gemini today) must validate the model output
 * against the zod schema and demote `suggestedCategoryKey` values
 * absent from `workspaceCategories` to null.
 */
export interface VoiceDraftPort {
  processAudio(
    audioBytes: Uint8Array,
    mimeType: string,
    workspaceCategories: readonly CategoryView[],
  ): Promise<Result<VoiceExtraction, DomainError>>;
}

export const VOICE_DRAFT_PROCESSOR = Symbol("VOICE_DRAFT_PROCESSOR");
