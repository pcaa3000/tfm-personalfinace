import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { FileHasherPort } from "./ports/file-hasher.port.js";
import type { VoiceFileHashPort } from "./ports/voice-file-hash.port.js";
import type { VoiceDraftDispatcher } from "./ports/voice-draft-dispatcher.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import type { VoiceStoragePort } from "./ports/voice-storage.port.js";
import {
  UploadVoiceNoteUseCase,
  type UploadVoiceNoteCommand,
} from "./upload-voice-note.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);
/** Same EBML signature, different content — a different file hash. */
const WEBM_2 = Uint8Array.from([...WEBM, 0xaa, 0xbb]);
const FAKE_WEBM = new TextEncoder().encode("not a real webm");
const NOW = new Date("2026-11-10T12:00:00.000Z");

function makeDeps() {
  const saved: VoiceNote[] = [];
  const storage: VoiceStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async (note: VoiceNote) => {
      saved.push(note);
    }),
    findById: vi.fn(async () => null),
  };
  const fileHashes: VoiceFileHashPort = {
    findByFileHash: vi.fn(async () => null),
  };
  // Deterministic content-derived hash — identical bytes collide like a
  // real SHA-256; the production adapter is CryptoFileHasher (receipts
  // infra, shared driver).
  const hasher: FileHasherPort = {
    sha256Hex: vi.fn(
      (bytes: Uint8Array) =>
        `hash-${bytes.byteLength}-${bytes[bytes.byteLength - 1] ?? 0}`,
    ),
  };
  const dispatcher: VoiceDraftDispatcher = {
    enqueueDraft: vi.fn(async () => undefined),
  };
  const useCase = new UploadVoiceNoteUseCase(
    storage,
    notes,
    fileHashes,
    hasher,
    dispatcher,
    { now: () => NOW },
    { next: () => "note-id-1" },
    { maxBytes: 1024 },
  );
  return { useCase, storage, notes, fileHashes, hasher, dispatcher, saved };
}

/** A stored note as the dedup lookup would return it. */
function storedNote(overrides: Partial<{
  id: string;
  status: "pending" | "failed" | "rejected";
  /** Media early-deleted/purged (retention, S7). */
  mediaDeleted: boolean;
}> = {}): VoiceNote {
  const note = VoiceNote.quarantine({
    id: overrides.id ?? "note-existing",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-1/${overrides.id ?? "note-existing"}.webm`,
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: WEBM.byteLength,
    fileHash: "hash-12-114",
    now: NOW,
  });
  if (!note.ok) throw note.error;
  if (overrides.status === "failed") {
    note.value.markFailed("pipeline blew up", NOW);
  }
  if (overrides.status === "rejected") {
    note.value.markRejected(NOW);
  }
  if (overrides.mediaDeleted) {
    note.value.markMediaDeleted(new Date("2026-11-09T12:00:00.000Z"));
  }
  return note.value;
}

function command(overrides: Partial<UploadVoiceNoteCommand> = {}): UploadVoiceNoteCommand {
  return {
    workspaceId: WS,
    uploaderSubject: "user-1",
    originalFilename: "nota.webm",
    bytes: WEBM,
    ...overrides,
  };
}

describe("UploadVoiceNoteUseCase — quarantine gate (voice-drafts T1, S1+S5)", () => {
  it("stores the bytes, persists a pending note row and enqueues voice-draft", async () => {
    const { useCase, storage, notes, dispatcher, saved } = makeDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.value;
    expect(view.id).toBe("note-id-1");
    expect(view.workspaceId).toBe("ws-1");
    expect(view.status).toBe("pending");
    expect(view.mimeType).toBe("audio/webm");
    expect(view.sizeBytes).toBe(WEBM.byteLength);
    expect(view.originalFilename).toBe("nota.webm");
    // S7: fixed 30-day expiry stamped at capture, live media.
    expect(view.expiresAt).toBe(
      new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(view.mediaDeletedAt).toBeNull();
    expect(view.transcript).toBeNull();

    // Bytes persisted under a quarantine key derived from the sniffed
    // mime, not from the client-supplied extension.
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringMatching(/^quarantine\/ws-1\/note-id-1\.webm$/),
      WEBM,
      "audio/webm",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("pending");
    expect(saved[0]!.storageKey).toBe("quarantine/ws-1/note-id-1.webm");
    // Minimal job payload for the T2 worker handler — the workspace id
    // scopes the worker's repository lookup.
    expect(dispatcher.enqueueDraft).toHaveBeenCalledWith("note-id-1", "ws-1");
    expect(notes.save).toHaveBeenCalled();
  });

  it("rejects a fake .webm by magic bytes BEFORE touching storage (VOICE_TYPE_NOT_ALLOWED)", async () => {
    const { useCase, storage, notes, dispatcher } = makeDeps();

    const result = await useCase.execute(command({ bytes: FAKE_WEBM }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_TYPE_NOT_ALLOWED");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueDraft).not.toHaveBeenCalled();
  });

  it("rejects an empty upload with VOICE_EMPTY before storing", async () => {
    const { useCase, storage, notes, dispatcher } = makeDeps();

    const result = await useCase.execute(
      command({ bytes: new Uint8Array(0) }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_EMPTY");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueDraft).not.toHaveBeenCalled();
  });

  it("rejects bytes over the limit with VOICE_TOO_LARGE before storing", async () => {
    const { useCase, storage, notes, dispatcher } = makeDeps();
    const big = new Uint8Array(1025);
    big.set(WEBM.slice(0, 4));

    const result = await useCase.execute(command({ bytes: big }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_TOO_LARGE");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueDraft).not.toHaveBeenCalled();
  });

  it("extension in the storage key follows the sniffed mime, not the filename", async () => {
    const { useCase, storage } = makeDeps();

    const result = await useCase.execute(
      command({ originalFilename: "evaded.mp3" }),
    );

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringMatching(/\.webm$/),
      WEBM,
      "audio/webm",
    );
  });

  it("a dispatcher failure does not fail the upload — the pending row is the source of truth", async () => {
    const { useCase, dispatcher } = makeDeps();
    vi.mocked(dispatcher.enqueueDraft).mockRejectedValueOnce(
      new Error("pg-boss down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
    }
    errorSpy.mockRestore();
  });
});

describe("UploadVoiceNoteUseCase — exact-hash dedup (T1, S5)", () => {
  it("hashes the uploaded bytes and stores fileHash on the new row", async () => {
    const { useCase, hasher, fileHashes, saved } = makeDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    // The hash is computed over the same bytes handed to storage.
    expect(hasher.sha256Hex).toHaveBeenCalledWith(WEBM);
    expect(fileHashes.findByFileHash).toHaveBeenCalledWith(
      WS,
      "hash-12-114",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.fileHash).toBe("hash-12-114");
  });

  it("returns the existing note for identical bytes — no second file, row or job", async () => {
    const { useCase, storage, notes, fileHashes, dispatcher, saved } =
      makeDeps();
    const first = await useCase.execute(command());
    // The second upload finds what the first persisted.
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(
      saved[0] ?? null,
    );
    const second = await useCase.execute(command());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id);
      expect(second.value.status).toBe(first.value.status);
    }
    // Idempotent: one stored object, one row, one enqueued job.
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(notes.save).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueDraft).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it("still returns the existing note when it is failed — retry owns re-enqueue", async () => {
    const { useCase, storage, notes, fileHashes, dispatcher } = makeDeps();
    const failed = storedNote({ id: "note-failed", status: "failed" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(failed);

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("note-failed");
      expect(result.value.status).toBe("failed");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueDraft).not.toHaveBeenCalled();
  });

  it("a rejected dedup hit is reused: pending + re-enqueued over the original storageKey", async () => {
    const { useCase, storage, notes, fileHashes, dispatcher } = makeDeps();
    const rejected = storedNote({ id: "note-rej", status: "rejected" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(rejected);

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("note-rej");
      expect(result.value.status).toBe("pending");
    }
    expect(rejected.status).toBe("pending");
    expect(notes.save).toHaveBeenCalledWith(rejected);
    expect(dispatcher.enqueueDraft).toHaveBeenCalledWith(
      "note-rej",
      WS.value,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("a rejected dedup hit with media deleted re-stores the bytes under the original key and clears the marker (S7)", async () => {
    const { useCase, storage, notes, fileHashes, dispatcher } = makeDeps();
    const rejected = storedNote({
      id: "note-rej-media",
      status: "rejected",
      mediaDeleted: true,
    });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(rejected);

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("note-rej-media");
      expect(result.value.status).toBe("pending");
      expect(result.value.mediaDeletedAt).toBeNull();
    }
    // The object is gone (early delete/purge): re-store the SAME bytes
    // under the ORIGINAL storageKey so the re-enqueued draft job finds it.
    expect(storage.save).toHaveBeenCalledWith(
      "quarantine/ws-1/note-rej-media.webm",
      WEBM,
      "audio/webm",
    );
    expect(rejected.mediaDeletedAt).toBeNull();
    expect(rejected.status).toBe("pending");
    expect(notes.save).toHaveBeenCalledWith(rejected);
    expect(dispatcher.enqueueDraft).toHaveBeenCalledWith(
      "note-rej-media",
      WS.value,
    );
  });

  it("a rejected dedup hit whose re-enqueue fails is marked failed — never stuck pending", async () => {
    const { useCase, notes, fileHashes, dispatcher } = makeDeps();
    const rejected = storedNote({ id: "note-rej2", status: "rejected" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(rejected);
    vi.mocked(dispatcher.enqueueDraft).mockRejectedValueOnce(new Error("boss down"));

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
    }
    expect(rejected.status).toBe("failed");
    expect(notes.save).toHaveBeenCalledTimes(2);
  });

  it("a second upload of DIFFERENT bytes stores a fresh note", async () => {
    const { useCase, storage, saved } = makeDeps();

    const first = await useCase.execute(command());
    const second = await useCase.execute(command({ bytes: WEBM_2 }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.fileHash).not.toBe(saved[0]!.fileHash);
  });

  it("treats a unique-index race as a dedup hit — re-reads and returns the winner", async () => {
    const { useCase, notes, fileHashes } = makeDeps();
    // Concurrent identical upload: the lookup missed, the insert hit the
    // UNIQUE(workspaceId, fileHash) constraint, the winner now exists.
    const winner = storedNote({ id: "note-winner" });
    vi.mocked(fileHashes.findByFileHash)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    vi.mocked(notes.save).mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint_name: "voices_voice_notes_workspaceId_fileHash_key",
      }),
    );

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("note-winner");
    }
    expect(fileHashes.findByFileHash).toHaveBeenCalledTimes(2);
  });
});
