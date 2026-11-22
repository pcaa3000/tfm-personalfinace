import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cleanE2eData, closeTestDb, db } from "../../test/e2e-helpers.js";
import {
  voiceConsents,
  voiceNotes,
  workspaces,
} from "../drizzle/schema.js";
import { buildApp, envFromProcess } from "./composition.js";
import type { VoiceDraftPort } from "../modules/voices/index.js";
import { ok } from "../modules/shared-kernel/index.js";

/**
 * Voice consent e2e (voice-drafts T5, S6 — docs/05 RF-070 +
 * revocación): real HTTP + Postgres — GET/PATCH /voices/consent scoped
 * to (workspace, subject, provider 'gemini'), revocation keeps the
 * record, and a pending upload after revoke NEVER reaches the
 * processor (the consent gate fails it before dispatch).
 */

const MARKER = "|e2e-voice-consent-";
const ALICE = { "x-dev-user": "e2e-voice-consent-alice" };
const BOB = { "x-dev-user": "e2e-voice-consent-bob" };

const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

let baseUrl = "";
let storageDir = "";
let closeApp: () => Promise<void>;

interface ApiJson {
  status: number;
  body: Record<string, unknown> | null;
}

async function json(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<ApiJson> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function uploadVoice(headers: Record<string, string>) {
  const form = new FormData();
  form.append(
    "file",
    new File(
      [
        Uint8Array.from([
          ...WEBM,
          ...new TextEncoder().encode(randomUUID()),
        ]),
      ],
      "nota.webm",
      { type: "audio/webm" },
    ),
  );
  const res = await fetch(`${baseUrl}/api/v1/voices`, {
    method: "POST",
    headers,
    body: form,
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function waitForVoiceStatus(
  noteId: string,
  headers: Record<string, string>,
  wanted: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const res = await json(`/api/v1/voices/${noteId}`, { headers });
    last = res.body;
    if (last?.status === wanted) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `note ${noteId} never reached ${wanted}; last=${JSON.stringify(last)}`,
  );
}

/** Counting stand-in for Gemini — proves the audio never left. */
const processAudio = vi.fn(async () =>
  ok({
    transcript: "compré un sol de pan",
    type: "expense" as const,
    concept: "Pan",
    dateHint: null,
    totalMinorUnits: null,
    items: [
      {
        concept: "Pan",
        amountMinorUnits: 100,
        currency: null,
        suggestedCategoryKey: null,
        suggestedNewCategory: null,
        confidence: 0.95,
      },
    ],
  }),
);
const fakeVoiceProcessor: VoiceDraftPort = { processAudio };

async function cleanupRows(): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%${MARKER}%`));
  const ids = owned.map((w) => w.id);
  if (ids.length > 0) {
    await db.delete(voiceConsents).where(inArray(voiceConsents.workspaceId, ids));
    await db.delete(voiceNotes).where(inArray(voiceNotes.workspaceId, ids));
  }
}

describe("voice consent e2e (voice-drafts T5, S6)", () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), "tfm-voice-consent-e2e-"));
    process.env.DATABASE_URL ??= DATABASE_URL;
    process.env.AUTH_MODE ??= "dev";
    process.env.RATE_LIMIT_MAX ??= "100000";
    process.env.STORAGE_DRIVER = "local";
    process.env.RECEIPT_STORAGE_DIR = storageDir;
    // Same wiring as voices.e2e: the inline dispatcher runs the REAL
    // pipeline — here it proves the consent gate stops revoked sends.
    process.env.VOICE_DISPATCHER = "inline";
    process.env.GEMINI_API_KEY = "e2e-inline-fake-key";
    const env = envFromProcess();
    const draftDispatcher = env.voices.draftDispatcher;
    if (draftDispatcher.mode !== "inline") {
      throw new Error("VOICE_DISPATCHER=inline was not parsed");
    }
    const built = buildApp({
      ...env,
      voices: {
        ...env.voices,
        draftDispatcher: { ...draftDispatcher, processor: fakeVoiceProcessor },
      },
    });
    const server = serve({ fetch: built.app.fetch, port: 0 });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeApp = async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await built.close();
    };
    await cleanE2eData(MARKER);
    await cleanupRows();
    processAudio.mockClear();
  });

  afterAll(async () => {
    await cleanupRows();
    await cleanE2eData(MARKER);
    await closeApp();
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.VOICE_DISPATCHER;
    delete process.env.GEMINI_API_KEY;
  });

  it("reads an undecided consent, grants it, and keeps the record after revoke", async () => {
    // RF-070: before any decision the flag is absent → the client gate
    // must show the provider dialog.
    const undecided = await json("/api/v1/voices/consent", {
      headers: ALICE,
    });
    expect(undecided.status).toBe(200);
    expect(undecided.body).toEqual({
      provider: "gemini",
      granted: false,
      grantedAt: null,
      revokedAt: null,
    });

    // Grant persists the acceptance instant.
    const granted = await json("/api/v1/voices/consent", {
      method: "PATCH",
      headers: ALICE,
      body: { granted: true },
    });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      provider: "gemini",
      granted: true,
      revokedAt: null,
    });
    expect(granted.body?.grantedAt).not.toBeNull();

    // Revocable (docs/05): the record survives with BOTH instants —
    // nothing is deleted.
    const revoked = await json("/api/v1/voices/consent", {
      method: "PATCH",
      headers: ALICE,
      body: { granted: false },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({
      provider: "gemini",
      granted: false,
    });
    expect(revoked.body?.grantedAt).toBe(granted.body?.grantedAt);
    expect(revoked.body?.revokedAt).not.toBeNull();

    const persisted = await json("/api/v1/voices/consent", {
      headers: ALICE,
    });
    expect(persisted.body).toEqual(revoked.body);
  });

  it("rejects a malformed consent payload with 400 INVALID_BODY", async () => {
    for (const body of [{ granted: "yes" }, {}, null]) {
      const res = await json("/api/v1/voices/consent", {
        method: "PATCH",
        headers: ALICE,
        body,
      });
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe("INVALID_BODY");
    }
  });

  it("scopes consent to the subject: alice's grant does not leak to bob", async () => {
    const bob = await json("/api/v1/voices/consent", { headers: BOB });
    expect(bob.status).toBe(200);
    expect(bob.body).toMatchObject({ granted: false });
  });

  it("blocks a pending upload after revoke — the processor never sees the audio", async () => {
    // ALICE revoked in the first spec — a new upload must be marked
    // failed by the consent gate and never reach the processor.
    processAudio.mockClear();
    const upload = await uploadVoice(ALICE);
    expect(upload.status).toBe(201);

    const failed = await waitForVoiceStatus(
      upload.body.id as string,
      ALICE,
      "failed",
    );
    expect(String(failed.error)).toContain("VOICE_CONSENT_REVOKED");
    expect(processAudio).not.toHaveBeenCalled();
  });

  it("re-grant after revoke re-enables the pipeline — upload reaches draft_ready", async () => {
    const regrant = await json("/api/v1/voices/consent", {
      method: "PATCH",
      headers: ALICE,
      body: { granted: true },
    });
    expect(regrant.status).toBe(200);
    expect(regrant.body).toMatchObject({ granted: true });

    processAudio.mockClear();
    const upload = await uploadVoice(ALICE);
    expect(upload.status).toBe(201);

    const ready = await waitForVoiceStatus(
      upload.body.id as string,
      ALICE,
      "draft_ready",
    );
    expect(ready.transcript).toBe("compré un sol de pan");
    expect(processAudio).toHaveBeenCalledTimes(1);
  });
});

// Root-level: the shared test pool outlives every describe's cleanup.
afterAll(async () => {
  await closeTestDb();
});
