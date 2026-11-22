import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VOICE_LLM_PROVIDER,
  VoiceConsent,
} from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import { GetVoiceConsentUseCase } from "./get-voice-consent.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw wsResult.error;
const WS = wsResult.value;

const GRANTED = new Date("2026-11-10T12:00:00.000Z");
const REVOKED = new Date("2026-11-11T12:00:00.000Z");

function consentsWith(record: VoiceConsent | null): VoiceConsentRepositoryPort {
  return {
    findConsent: vi.fn(async () => record),
    saveConsent: vi.fn(async () => undefined),
  };
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
    createdAt: GRANTED,
    updatedAt: GRANTED,
  });
}

/**
 * `GET /api/v1/voices/consent` read side (voice-drafts T5, S6): the
 * workspace+subject scoped decision projected for the client gate.
 * A missing record projects `granted:false` — the first send always
 * goes through the dialog (RF-070 explicit action).
 */
describe("GetVoiceConsentUseCase (voice-drafts T5, S6)", () => {
  it("projects a missing record as undecided — granted:false, no instants", async () => {
    const consents = consentsWith(null);
    const useCase = new GetVoiceConsentUseCase(consents);

    const view = await useCase.execute(WS, "user-1");

    expect(view).toEqual({
      provider: "gemini",
      granted: false,
      grantedAt: null,
      revokedAt: null,
    });
    expect(consents.findConsent).toHaveBeenCalledWith(
      WS,
      "user-1",
      "gemini",
    );
  });

  it("projects an active record with its acceptance instant", async () => {
    const useCase = new GetVoiceConsentUseCase(
      consentsWith(record(GRANTED, null)),
    );

    const view = await useCase.execute(WS, "user-1");

    expect(view).toEqual({
      provider: "gemini",
      granted: true,
      grantedAt: GRANTED.toISOString(),
      revokedAt: null,
    });
  });

  it("projects a revoked record — record kept, both instants surfaced", async () => {
    const useCase = new GetVoiceConsentUseCase(
      consentsWith(record(GRANTED, REVOKED)),
    );

    const view = await useCase.execute(WS, "user-1");

    expect(view).toEqual({
      provider: "gemini",
      granted: false,
      grantedAt: GRANTED.toISOString(),
      revokedAt: REVOKED.toISOString(),
    });
  });
});
