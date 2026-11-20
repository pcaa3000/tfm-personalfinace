import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanE2eData, closeTestDb, db } from "../../test/e2e-helpers.js";
import { voiceNotes, workspaces } from "../drizzle/schema.js";
import { buildApp, envFromProcess } from "./composition.js";
import { LocalReceiptStorage } from "../modules/receipts/index.js";
import type { VoiceDraftPort } from "../modules/voices/index.js";
import { ok } from "../modules/shared-kernel/index.js";

/**
 * Voice upload e2e (voice-drafts T1, S1+S5+S7): real HTTP + Postgres +
 * local fs storage — multipart upload → quarantine → poll → file
 * streaming → workspace list — with the fixed 30-day media expiry and
 * exact-hash dedup exercised end to end.
 */

const MARKER = "|e2e-voices-";
const ALICE = { "x-dev-user": "e2e-voices-alice" };
const BOB = { "x-dev-user": "e2e-voices-bob" };

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
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function uploadVoice(
  headers: Record<string, string>,
  bytes: Uint8Array = Uint8Array.from([
    ...WEBM,
    ...new TextEncoder().encode(randomUUID()),
  ]),
) {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes], "nota.webm", { type: "audio/webm" }),
  );
  const res = await fetch(`${baseUrl}/api/v1/voices`, {
    method: "POST",
    headers,
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function cleanupNotes(): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%${MARKER}%`));
  const ids = owned.map((w) => w.id);
  if (ids.length > 0) {
    await db
      .delete(voiceNotes)
      .where(inArray(voiceNotes.workspaceId, ids));
  }
}

/** Deterministic stand-in for Gemini (T2): a fixed expense extraction. */
const fakeVoiceProcessor: VoiceDraftPort = {
  processAudio: async () =>
    ok({
      transcript: "compré un sol de pan",
      type: "expense",
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
};

/** Polls GET /voices/:id until it reports `wanted` (T2 inline pipeline). */
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

describe("voices e2e (voice-drafts T1+T2, S1+S2+S5+S7)", () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), "tfm-voices-e2e-"));
    process.env.DATABASE_URL ??= DATABASE_URL;
    process.env.AUTH_MODE ??= "dev";
    process.env.RATE_LIMIT_MAX ??= "100000";
    process.env.STORAGE_DRIVER = "local";
    process.env.RECEIPT_STORAGE_DIR = storageDir;
    // T2: the inline dispatcher (S5 default) runs the REAL handleVoiceDraft
    // pipeline in-process; the fake VoiceDraftPort replaces Gemini through
    // the `processor` seam. GEMINI_API_KEY is still required — the API
    // fails fast without it exactly like the worker does.
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
    await cleanupNotes();
  });

  afterAll(async () => {
    await cleanupNotes();
    await cleanE2eData(MARKER);
    await closeApp();
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.VOICE_DISPATCHER;
    delete process.env.GEMINI_API_KEY;
  });

  it("upload → poll → file → list, with the 30-day expiry and real stored bytes", async () => {
    const upload = await uploadVoice(ALICE);
    expect(upload.status).toBe(201);
    const noteId = upload.body.id as string;
    expect(upload.body.status).toBe("pending");
    expect(upload.body.mimeType).toBe("audio/webm");

    // S7: fixed retention — expiresAt = createdAt + 30 days, live media.
    expect(upload.body.expiresAt).toBe(
      new Date(
        Date.parse(upload.body.createdAt as string) + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(upload.body.mediaDeletedAt).toBeNull();

    // GET /:id polling view — the inline T2 pipeline drives the note
    // to draft_ready; poll until it lands (S7: transcript persisted).
    const poll = await waitForVoiceStatus(noteId, ALICE, "draft_ready");
    expect(poll).toMatchObject({
      id: noteId,
      status: "draft_ready",
      mimeType: "audio/webm",
      transcript: "compré un sol de pan",
      transactionId: null,
    });

    // GET /:id/file streams the exact stored bytes back.
    const file = await fetch(`${baseUrl}/api/v1/voices/${noteId}/file`, {
      headers: ALICE,
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("audio/webm");
    const served = new Uint8Array(await file.arrayBuffer());
    expect(served.byteLength).toBeGreaterThan(WEBM.byteLength);
    expect(served.slice(0, WEBM.byteLength)).toEqual(WEBM);

    // The object really landed in the shared local storage driver.
    const local = new LocalReceiptStorage(storageDir);
    const [row] = await db
      .select()
      .from(voiceNotes)
      .where(inArray(voiceNotes.id, [noteId]));
    expect(row).toBeDefined();
    expect(await local.open(row!.storageKey)).not.toBeNull();

    // GET /voices list contains the note with the transaction link null.
    const list = await json("/api/v1/voices", { headers: ALICE });
    expect(list.status).toBe(200);
    const items = (
      list.body as unknown as { items: Array<Record<string, unknown>> }
    ).items;
    const item = items.find((i) => i.id === noteId);
    expect(item).toMatchObject({
      status: "draft_ready",
      fileMimeType: "audio/webm",
      transactionId: null,
      mediaDeletedAt: null,
    });
  });

  it("rejects a non-audio file with 400 VOICE_TYPE_NOT_ALLOWED and stores nothing", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([new TextEncoder().encode("plain text, not audio")], "x.webm", {
        type: "audio/webm",
      }),
    );
    const res = await fetch(`${baseUrl}/api/v1/voices`, {
      method: "POST",
      headers: ALICE,
      body: form,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(
      "VOICE_TYPE_NOT_ALLOWED",
    );
  });

  it("duplicate upload of the same bytes returns the same note id (dedup, S5)", async () => {
    const bytes = Uint8Array.from([
      ...WEBM,
      ...new TextEncoder().encode(`dup-${randomUUID()}`),
    ]);

    const first = await uploadVoice(ALICE, bytes);
    const second = await uploadVoice(ALICE, bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it("a foreign workspace cannot read the note or its file", async () => {
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;

    const poll = await json(`/api/v1/voices/${noteId}`, { headers: BOB });
    expect(poll.status).toBe(404);

    const file = await fetch(`${baseUrl}/api/v1/voices/${noteId}/file`, {
      headers: BOB,
    });
    expect(file.status).toBe(404);
  });
});

// Root-level: the shared test pool outlives every describe's cleanup.
afterAll(async () => {
  await closeTestDb();
});
