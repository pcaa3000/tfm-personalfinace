import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import {
  VOICE_LLM_PROVIDER,
  VoiceConsent,
} from "../domain/voice-consent.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { VoiceDraftConsentGuard } from "./voice-draft-consent-guard.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw wsResult.error;
const WS = wsResult.value;

const NOW = new Date("2026-11-10T12:00:00.000Z");
const clock: Clock = { now: () => NOW };

function pendingNote(uploaderSubject = "user-1"): VoiceNote {
  const note = VoiceNote.quarantine({
    id: "note-1",
    workspaceId: WS,
    uploaderSubject,
    storageKey: `quarantine/${WS.value}/note-1.webm`,
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 1234,
    fileHash: "a".repeat(64),
    now: NOW,
  });
  if (!note.ok) throw note.error;
  return note.value;
}

function consentRecord(
  grantedAt: Date | null,
  revokedAt: Date | null,
): VoiceConsent {
  return VoiceConsent.reconstitute({
    id: "consent-1",
    workspaceId: WS.value,
    subject: "user-1",
    provider: VOICE_LLM_PROVIDER,
    grantedAt,
    revokedAt,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function fixture(options: {
  note?: VoiceNote | null;
  consent?: VoiceConsent | null;
} = {}) {
  const note = options.note === undefined ? pendingNote() : options.note;
  const notes: VoiceNoteRepositoryPort = {
    findById: vi.fn(async () => note),
    save: vi.fn(async () => undefined),
  };
  const consents: VoiceConsentRepositoryPort = {
    findConsent: vi.fn(async () => options.consent ?? null),
    saveConsent: vi.fn(async () => undefined),
  };
  return {
    notes,
    consents,
    note,
    guard: new VoiceDraftConsentGuard(notes, consents, clock),
  };
}

/**
 * docs/05 revocation gate (voice-drafts T5, S6): "Detiene nuevos envíos
 * inmediatamente" — a pending note must never reach the provider once
 * its uploader revoked. A missing record does NOT block: first-send
 * consent is the client gate (RF-070 explicit action), so non-web
 * uploads keep the documented client-gate model.
 */
describe("VoiceDraftConsentGuard (voice-drafts T5, S6)", () => {
  it("blocks a pending note whose uploader revoked — marks it failed, never dispatches", async () => {
    const { guard, notes, note } = fixture({
      consent: consentRecord(NOW, new Date("2026-11-11T12:00:00.000Z")),
    });

    const dispatchable = await guard.ensureDispatchable("note-1", WS.value);

    expect(dispatchable).toBe(false);
    expect(note!.status).toBe("failed");
    expect(note!.error).toContain("VOICE_CONSENT_REVOKED");
    expect(notes.save).toHaveBeenCalledWith(note);
  });

  it("lets a pending note through when consent is active", async () => {
    const { guard, notes, note } = fixture({
      consent: consentRecord(NOW, null),
    });

    const dispatchable = await guard.ensureDispatchable("note-1", WS.value);

    expect(dispatchable).toBe(true);
    expect(note!.status).toBe("pending");
    expect(notes.save).not.toHaveBeenCalled();
  });

  it("lets a pending note through when no record exists — the client gates the first send", async () => {
    const { guard, notes } = fixture({ consent: null });

    const dispatchable = await guard.ensureDispatchable("note-1", WS.value);

    expect(dispatchable).toBe(true);
    expect(notes.save).not.toHaveBeenCalled();
  });

  it("scopes the consent lookup to the note's uploader, not the dispatcher", async () => {
    const { guard, consents } = fixture({
      note: pendingNote("uploader-sub"),
      consent: null,
    });

    await guard.ensureDispatchable("note-1", WS.value);

    expect(consents.findConsent).toHaveBeenCalledWith(
      WS,
      "uploader-sub",
      "gemini",
    );
  });

  it("does not touch a non-pending note even after revoke — nothing left to send", async () => {
    const note = pendingNote();
    note.markDraftReady({}, {}, "t", NOW);
    const { guard, notes } = fixture({
      note,
      consent: consentRecord(NOW, new Date("2026-11-11T12:00:00.000Z")),
    });

    const dispatchable = await guard.ensureDispatchable("note-1", WS.value);

    expect(dispatchable).toBe(true);
    expect(note.status).toBe("draft_ready");
    expect(notes.save).not.toHaveBeenCalled();
  });

  it("lets the job handle a missing note — no consent lookup needed", async () => {
    const { guard, consents } = fixture({ note: null });

    const dispatchable = await guard.ensureDispatchable("ghost", WS.value);

    expect(dispatchable).toBe(true);
    expect(consents.findConsent).not.toHaveBeenCalled();
  });
});
