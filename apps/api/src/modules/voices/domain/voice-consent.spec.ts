import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VOICE_LLM_PROVIDER,
  VoiceConsent,
} from "./voice-consent.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const LATER = new Date("2026-11-11T12:00:00.000Z");
const REGRANT = new Date("2026-11-12T12:00:00.000Z");

function ws(value = "ws-1"): WorkspaceId {
  const result = WorkspaceId.create(value);
  if (!result.ok) throw result.error;
  return result.value;
}

function createConsent() {
  return VoiceConsent.create({
    id: "consent-1",
    workspaceId: ws(),
    subject: "user-1",
    provider: VOICE_LLM_PROVIDER,
    now: NOW,
  });
}

/**
 * Provider consent record (voice-drafts T5, S6 — docs/05 RF-070):
 * one row per (workspace, subject, provider) keeps the LATEST decision
 * with both instants — revocation never deletes the record.
 */
describe("VoiceConsent (voice-drafts T5, S6)", () => {
  it("starts undecided — neither granted nor revoked, never active", () => {
    const consent = createConsent();

    expect(consent.active).toBe(false);
    expect(consent.grantedAt).toBeNull();
    expect(consent.revokedAt).toBeNull();
  });

  it("grant() stamps the acceptance instant and activates the consent", () => {
    const consent = createConsent();

    consent.grant(NOW);

    expect(consent.grantedAt).toEqual(NOW);
    expect(consent.active).toBe(true);
  });

  it("revoke() stamps revokedAt and deactivates — the record is kept", () => {
    const consent = createConsent();

    consent.grant(NOW);
    consent.revoke(LATER);

    expect(consent.grantedAt).toEqual(NOW);
    expect(consent.revokedAt).toEqual(LATER);
    expect(consent.active).toBe(false);
  });

  it("a re-grant after revoke reactivates — the latest instant wins, both stamps kept", () => {
    const consent = createConsent();

    consent.grant(NOW);
    consent.revoke(LATER);
    consent.grant(REGRANT);

    expect(consent.grantedAt).toEqual(REGRANT);
    expect(consent.revokedAt).toEqual(LATER);
    expect(consent.active).toBe(true);
  });

  it("a revoke without a prior grant stays inactive and records the refusal instant", () => {
    const consent = createConsent();

    consent.revoke(LATER);

    expect(consent.grantedAt).toBeNull();
    expect(consent.revokedAt).toEqual(LATER);
    expect(consent.active).toBe(false);
  });

  it("reconstitutes the persisted state without re-deciding", () => {
    const consent = VoiceConsent.reconstitute({
      id: "consent-9",
      workspaceId: "ws-9",
      subject: "user-9",
      provider: "gemini",
      grantedAt: NOW,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(consent.active).toBe(true);
    expect(consent.workspaceId.value).toBe("ws-9");
    expect(consent.subject).toBe("user-9");
    expect(consent.provider).toBe("gemini");
  });
});
