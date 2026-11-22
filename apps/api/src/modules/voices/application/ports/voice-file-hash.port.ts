import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { VoiceNote } from "../../domain/voice-note.js";

/**
 * Exact-content dedup index (voice-drafts T1, S5): workspace-scoped
 * lookup of a previously uploaded note by the SHA-256 hex of its bytes.
 * Backed by UNIQUE(workspaceId, fileHash); NULL hashes never match.
 */
export interface VoiceFileHashPort {
  findByFileHash(
    workspaceId: WorkspaceId,
    fileHash: string,
  ): Promise<VoiceNote | null>;
}

export const VOICE_FILE_HASH = Symbol("VOICE_FILE_HASH");
