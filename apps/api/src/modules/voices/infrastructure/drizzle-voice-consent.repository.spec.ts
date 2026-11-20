import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { voiceConsents } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VOICE_LLM_PROVIDER,
  VoiceConsent,
} from "../domain/voice-consent.js";
import { DrizzleVoiceConsentRepository } from "./drizzle-voice-consent.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "voice-consent-repo-a";
const WS_B = "voice-consent-repo-b";
const WORKSPACES = [WS_A, WS_B];

const NOW = new Date("2026-11-10T12:00:00.000Z");
const LATER = new Date("2026-11-11T12:00:00.000Z");

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) throw id.error;
  return id.value;
}

const { db, pool } = createDrizzleDb(DATABASE_URL);
const repository = new DrizzleVoiceConsentRepository(db);

async function cleanup(): Promise<void> {
  await db
    .delete(voiceConsents)
    .where(inArray(voiceConsents.workspaceId, WORKSPACES));
}

/**
 * Real-DB spec for the `voices_voice_consents` adapter (voice-drafts
 * T5, S6): upsert keyed by UNIQUE(workspaceId, subject, provider) —
 * revocation updates the same row, never deletes it.
 */
describe("DrizzleVoiceConsentRepository (voice-drafts T5, S6)", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("finds nothing before the first decision is persisted", async () => {
    const found = await repository.findConsent(
      workspaceId(WS_A),
      "user-1",
      VOICE_LLM_PROVIDER,
    );

    expect(found).toBeNull();
  });

  it("persists a granted consent and reads it back workspace+subject scoped", async () => {
    const consent = VoiceConsent.create({
      id: "consent-a-1",
      workspaceId: workspaceId(WS_A),
      subject: "user-1",
      provider: VOICE_LLM_PROVIDER,
      now: NOW,
    });
    consent.grant(NOW);

    await repository.saveConsent(consent);

    const found = await repository.findConsent(
      workspaceId(WS_A),
      "user-1",
      VOICE_LLM_PROVIDER,
    );
    expect(found).not.toBeNull();
    expect(found!.active).toBe(true);
    expect(found!.grantedAt).toEqual(NOW);
    expect(found!.revokedAt).toBeNull();

    // Scope: a different subject/workspace sees no record.
    expect(
      await repository.findConsent(
        workspaceId(WS_A),
        "user-2",
        VOICE_LLM_PROVIDER,
      ),
    ).toBeNull();
    expect(
      await repository.findConsent(
        workspaceId(WS_B),
        "user-1",
        VOICE_LLM_PROVIDER,
      ),
    ).toBeNull();
  });

  it("revocation updates the SAME row — record kept with both instants", async () => {
    const consent = (
      await repository.findConsent(
        workspaceId(WS_A),
        "user-1",
        VOICE_LLM_PROVIDER,
      )
    )!;
    consent.revoke(LATER);
    await repository.saveConsent(consent);

    const found = await repository.findConsent(
      workspaceId(WS_A),
      "user-1",
      VOICE_LLM_PROVIDER,
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe("consent-a-1");
    expect(found!.grantedAt).toEqual(NOW);
    expect(found!.revokedAt).toEqual(LATER);
    expect(found!.active).toBe(false);
  });
});
