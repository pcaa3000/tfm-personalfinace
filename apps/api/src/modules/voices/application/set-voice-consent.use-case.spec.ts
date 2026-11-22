import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock, IdGenerator } from "../../ledger/index.js";
import {
  VOICE_LLM_PROVIDER,
  VoiceConsent,
} from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import { SetVoiceConsentUseCase } from "./set-voice-consent.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw wsResult.error;
const WS = wsResult.value;

const NOW = new Date("2026-11-10T12:00:00.000Z");
const EARLIER_GRANT = new Date("2026-11-01T12:00:00.000Z");
const EARLIER_REVOKE = new Date("2026-11-02T12:00:00.000Z");

const clock: Clock = { now: () => NOW };
const ids: IdGenerator = { next: () => "consent-new" };

function consentsWith(record: VoiceConsent | null) {
  const saved: VoiceConsent[] = [];
  const repo: VoiceConsentRepositoryPort = {
    findConsent: vi.fn(async () => record),
    saveConsent: vi.fn(async (consent: VoiceConsent) => {
      saved.push(consent);
    }),
  };
  return { repo, saved };
}

function record(
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
    createdAt: EARLIER_GRANT,
    updatedAt: EARLIER_GRANT,
  });
}

/**
 * `PATCH /api/v1/voices/consent` write side (voice-drafts T5, S6 —
 * docs/05): upserts the single (workspace, subject, provider) row.
 * Grant stamps `grantedAt`; revoke stamps `revokedAt` and keeps the
 * row — consent records are never deleted.
 */
describe("SetVoiceConsentUseCase (voice-drafts T5, S6)", () => {
  it("grant with no record creates the consent row for provider gemini", async () => {
    const { repo, saved } = consentsWith(null);
    const useCase = new SetVoiceConsentUseCase(repo, clock, ids);

    const view = await useCase.execute(WS, "user-1", { granted: true });

    expect(saved).toHaveLength(1);
    const consent = saved[0]!;
    expect(consent.workspaceId).toBe(WS);
    expect(consent.subject).toBe("user-1");
    expect(consent.provider).toBe(VOICE_LLM_PROVIDER);
    expect(consent.grantedAt).toEqual(NOW);
    expect(view).toEqual({
      provider: "gemini",
      granted: true,
      grantedAt: NOW.toISOString(),
      revokedAt: null,
    });
  });

  it("revoke on an active record stamps revokedAt and keeps grantedAt", async () => {
    const { repo, saved } = consentsWith(record(EARLIER_GRANT, null));
    const useCase = new SetVoiceConsentUseCase(repo, clock, ids);

    const view = await useCase.execute(WS, "user-1", { granted: false });

    const consent = saved[0]!;
    expect(consent.grantedAt).toEqual(EARLIER_GRANT);
    expect(consent.revokedAt).toEqual(NOW);
    expect(view).toEqual({
      provider: "gemini",
      granted: false,
      grantedAt: EARLIER_GRANT.toISOString(),
      revokedAt: NOW.toISOString(),
    });
  });

  it("revoke with no record persists the refusal — no phantom grant", async () => {
    const { repo, saved } = consentsWith(null);
    const useCase = new SetVoiceConsentUseCase(repo, clock, ids);

    const view = await useCase.execute(WS, "user-1", { granted: false });

    const consent = saved[0]!;
    expect(consent.grantedAt).toBeNull();
    expect(consent.revokedAt).toEqual(NOW);
    expect(view).toEqual({
      provider: "gemini",
      granted: false,
      grantedAt: null,
      revokedAt: NOW.toISOString(),
    });
  });

  it("re-grant after revoke stamps a fresh grantedAt — both instants kept", async () => {
    const { repo, saved } = consentsWith(
      record(EARLIER_GRANT, EARLIER_REVOKE),
    );
    const useCase = new SetVoiceConsentUseCase(repo, clock, ids);

    const view = await useCase.execute(WS, "user-1", { granted: true });

    const consent = saved[0]!;
    expect(consent.grantedAt).toEqual(NOW);
    expect(consent.revokedAt).toEqual(EARLIER_REVOKE);
    expect(consent.active).toBe(true);
    expect(view).toEqual({
      provider: "gemini",
      granted: true,
      grantedAt: NOW.toISOString(),
      revokedAt: EARLIER_REVOKE.toISOString(),
    });
  });

  it("scopes the lookup to the caller subject inside the workspace", async () => {
    const { repo } = consentsWith(null);
    const useCase = new SetVoiceConsentUseCase(repo, clock, ids);

    await useCase.execute(WS, "alice-subject", { granted: true });

    expect(repo.findConsent).toHaveBeenCalledWith(
      WS,
      "alice-subject",
      "gemini",
    );
  });
});
