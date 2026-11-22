import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanE2eData, closeTestDb, db } from "../../test/e2e-helpers.js";
import { categories, voiceNotes, workspaces } from "../drizzle/schema.js";
import { buildApp, envFromProcess } from "./composition.js";
import {
  DrizzleVoiceNoteRepository,
  type VoiceDraftPort,
} from "../modules/voices/index.js";
import { ok, WorkspaceId } from "../modules/shared-kernel/index.js";

/**
 * Voice draft approval e2e (voice-drafts T3, S2+S4+S5): real HTTP +
 * Postgres — multipart upload → the inline pipeline driven by a fake
 * VoiceDraftPort → draft GET (transcript + read-time
 * possibleDuplicates) → confirm → transaction with splits
 * (origin "voice") and the note linked as confirmed → replay →
 * reject/retry paths.
 */

const MARKER = "|e2e-vcfm-";
const ALICE = { "x-dev-user": "e2e-vcfm-alice" };
const BOB = { "x-dev-user": "e2e-vcfm-bob" };

const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

let baseUrl = "";
let storageDir = "";
let closeApp: () => Promise<void>;

/**
 * Deterministic stand-in for Gemini: a transcript + three items that
 * group into a catalog-key split, a newCategory proposal and an
 * uncategorized low-confidence split.
 */
const fakeVoiceProcessor: VoiceDraftPort = {
  processAudio: async () =>
    ok({
      transcript:
        "compré arroz a veinte soles, un sachet de champú a diez y algo más a cinco cincuenta",
      type: "expense",
      concept: "Compra bodega",
      dateHint: null,
      totalMinorUnits: 3550,
      items: [
        {
          concept: "Arroz",
          amountMinorUnits: 2000,
          currency: null,
          suggestedCategoryKey: "food",
          suggestedNewCategory: null,
          confidence: 0.95,
        },
        {
          concept: "Sachet de champú",
          amountMinorUnits: 1000,
          currency: null,
          suggestedCategoryKey: null,
          suggestedNewCategory: {
            name: "Cuidado personal",
            nature: "essential",
          },
          confidence: 0.8,
        },
        {
          concept: "Item raro",
          amountMinorUnits: 550,
          currency: null,
          suggestedCategoryKey: null,
          suggestedNewCategory: null,
          confidence: 0.4,
        },
      ],
    }),
};

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
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** Polls GET /voices/:id until it reports `wanted` (inline pipeline). */
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

async function workspaceIdOf(
  headers: Record<string, string>,
): Promise<string> {
  await json("/api/v1/categories", { headers });
  const subject = headers["x-dev-user"]!;
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%|${subject}`))
    .limit(1);
  if (!row) throw new Error(`workspace not found for ${subject}`);
  return row.id;
}

async function categoryIdByKey(
  headers: Record<string, string>,
  key: string,
): Promise<string> {
  const res = await json(`/api/v1/categories`, { headers });
  const list = res.body as unknown as Array<{ id: string; key: string }>;
  const found = list.find((c) => c.key === key);
  if (!found) throw new Error(`category ${key} not found in catalog`);
  return found.id;
}

async function cleanupNotes(): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%${MARKER}%`));
  const ids = owned.map((w) => w.id);
  if (ids.length > 0) {
    await db.delete(voiceNotes).where(inArray(voiceNotes.workspaceId, ids));
  }
}

async function createPenAccount(): Promise<string> {
  const res = await json("/api/v1/accounts", {
    method: "POST",
    headers: ALICE,
    body: { name: `e2e-vcfm-${randomUUID()}`, currency: "PEN" },
  });
  return (res.body as { id: string }).id;
}

describe("voice draft review + confirm e2e (voice-drafts T3, S2+S4+S5)", () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), "tfm-voices-confirm-e2e-"));
    process.env.DATABASE_URL ??= DATABASE_URL;
    process.env.AUTH_MODE ??= "dev";
    process.env.RATE_LIMIT_MAX ??= "100000";
    process.env.STORAGE_DRIVER = "local";
    process.env.RECEIPT_STORAGE_DIR = storageDir;
    // The default inline dispatcher (S5) runs the real handleVoiceDraft
    // pipeline in-process; the fake VoiceDraftPort replaces Gemini
    // through the `processor` seam. GEMINI_API_KEY is still required —
    // the API fails fast without it exactly like the worker does.
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
        draftDispatcher: {
          ...draftDispatcher,
          processor: fakeVoiceProcessor,
        },
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
    // No sys-uncategorized cleanup here: it is shared seed data other
    // parallel suites may still reference — the receipts confirm e2e
    // owns it (same convention as receipts-media).
    await closeApp();
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.VOICE_DISPATCHER;
    delete process.env.GEMINI_API_KEY;
  });

  it("upload → fake draft → draft GET → confirm creates a split transaction (origin voice)", async () => {
    const upload = await uploadVoice(ALICE);
    expect(upload.status).toBe(201);
    const noteId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    expect(upload.body.status).toBe("pending");

    // The draft is not reviewable while the pipeline is still pending.
    const early = await json(`/api/v1/voices/${noteId}/draft`, {
      headers: ALICE,
    });
    // May already be draft_ready (inline) — only assert on a non-ready read.
    if (early.status === 409) {
      expect((early.body as { code: string }).code).toBe("VOICE_NOT_READY");
    }

    await waitForVoiceStatus(noteId, ALICE, "draft_ready");

    const draft = await json(`/api/v1/voices/${noteId}/draft`, {
      headers: ALICE,
    });
    expect(draft.status).toBe(200);
    const payload = draft.body as {
      transcript: string;
      concept: string;
      businessDate: string;
      currency: string;
      splits: Array<{
        categoryKey: string | null;
        newCategory: { name: string; nature: string } | null;
        amountMinorUnits: number;
        lowConfidence: boolean;
      }>;
      possibleDuplicates: Array<{
        transactionId: string;
        concept: string;
        amount: number;
        occurredOn: string;
      }>;
    };
    expect(payload.transcript).toContain("sachet de champú");
    expect(payload.concept).toBe("Compra bodega");
    expect(payload.currency).toBe("PEN");
    expect(payload.splits).toHaveLength(3);
    expect(
      payload.splits.reduce((sum, s) => sum + s.amountMinorUnits, 0),
    ).toBe(3550);

    // possibleDuplicates is computed at read time: a same-amount,
    // same-window expense recorded now must show up on the next read.
    const prior = await json("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: {
        type: "expense",
        amount: "35.50",
        currency: "PEN",
        businessDate: payload.businessDate,
        timezone: "UTC",
        concept: "Compra bodega",
        accountId: await createPenAccount(),
        idempotencyKey: `e2e-vdup-${randomUUID()}`,
      },
    });
    expect(prior.status).toBe(201);
    const priorTxId = (prior.body as { id: string }).id;

    const draftAgain = await json(`/api/v1/voices/${noteId}/draft`, {
      headers: ALICE,
    });
    expect(draftAgain.status).toBe(200);
    const dups = (
      draftAgain.body as {
        possibleDuplicates: Array<{
          transactionId: string;
          concept: string;
          amount: number;
          occurredOn: string;
        }>;
      }
    ).possibleDuplicates;
    expect(dups).toEqual([
      {
        transactionId: priorTxId,
        concept: "Compra bodega",
        amount: 3550,
        occurredOn: payload.businessDate,
      },
    ]);

    const foodId = await categoryIdByKey(ALICE, "food");
    // NOTE: no `categoryId: null` split here — confirming one would
    // provision and reference the shared `sys-uncategorized` row, which
    // the receipts confirm e2e deletes in its afterAll while parallel
    // suites still run (same convention receipts-media documents). The
    // null → sys-uncategorized mapping is covered by the unit spec.
    const confirm = await json(`/api/v1/voices/${noteId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: await createPenAccount(),
        type: "expense",
        idempotencyKey: `e2e-vconfirm-${randomUUID()}`,
        splits: [
          { categoryId: foodId, amountMinorUnits: 2000 },
          {
            newCategory: { name: "Cuidado personal", nature: "essential" },
            amountMinorUnits: 1550,
          },
        ],
      },
    });

    expect(confirm.status).toBe(201);
    const confirmed = confirm.body as {
      transaction: {
        id: string;
        type: string;
        amount: string;
        currency: string;
        origin: string;
        originReference: string;
        concept: string;
        splits: Array<{ categoryId: string; amount: string }>;
      };
      createdCategories: Array<{ key: string }>;
    };
    expect(confirmed.transaction.type).toBe("expense");
    expect(confirmed.transaction.amount).toBe("35.50");
    expect(confirmed.transaction.currency).toBe("PEN");
    expect(confirmed.transaction.origin).toBe("voice");
    expect(confirmed.transaction.originReference).toBe(noteId);
    expect(confirmed.transaction.concept).toBe("Compra bodega");
    expect(confirmed.transaction.splits).toHaveLength(2);
    expect(
      confirmed.transaction.splits.reduce(
        (sum, s) => sum + Number.parseFloat(s.amount),
        0,
      ),
    ).toBeCloseTo(35.5, 2);
    // S4: only the approved newCategory was created and reported.
    expect(confirmed.createdCategories.map((c) => c.key)).toEqual([
      "cuidado_personal",
    ]);

    // The note is confirmed and linked to the transaction.
    const after = await json(`/api/v1/voices/${noteId}`, { headers: ALICE });
    expect((after.body as { status: string }).status).toBe("confirmed");
    expect((after.body as { transactionId: string }).transactionId).toBe(
      confirmed.transaction.id,
    );

    // The created category really exists in the workspace catalog.
    const created = await db
      .select()
      .from(categories)
      .where(eq(categories.key, "cuidado_personal"));
    expect(created.some((c) => c.workspaceId === wsId)).toBe(true);
  });

  it("replaying the same confirm returns the same transaction without duplicates", async () => {
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;
    await waitForVoiceStatus(noteId, ALICE, "draft_ready");
    const foodId = await categoryIdByKey(ALICE, "food");
    const key = `e2e-vreplay-${randomUUID()}`;
    const body = {
      accountId: await createPenAccount(),
      type: "expense",
      idempotencyKey: key,
      splits: [
        { categoryId: foodId, amountMinorUnits: 2000 },
        {
          newCategory: { name: "Replay voice", nature: "discretionary" },
          amountMinorUnits: 1550,
        },
      ],
    };

    const first = await json(`/api/v1/voices/${noteId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body,
    });
    expect(first.status).toBe(201);
    const firstTx = (first.body as { transaction: { id: string } })
      .transaction;

    const replay = await json(`/api/v1/voices/${noteId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body,
    });
    expect(replay.status).toBe(201);
    const replayTx = (replay.body as { transaction: { id: string } })
      .transaction;
    expect(replayTx.id).toBe(firstTx.id);

    // No duplicated category or extra transaction row.
    const created = await db
      .select()
      .from(categories)
      .where(eq(categories.key, "replay_voice"));
    expect(created).toHaveLength(1);
    const rows = await db
      .select()
      .from(voiceNotes)
      .where(eq(voiceNotes.id, noteId));
    expect(rows[0]!.transactionId).toBe(firstTx.id);
  });

  it("confirm on a pending note returns 409 VOICE_NOT_READY and leaves no side effects", async () => {
    // Park a note as pending forever: the upload dedup needs unique bytes;
    // the note stays pending only while the inline job hasn't run — force
    // the row instead for determinism.
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    const ws = WorkspaceId.create(wsId);
    if (!ws.ok) throw ws.error;
    const repo = new DrizzleVoiceNoteRepository(db);
    // Wait for the inline pipeline first, then drive the row back to
    // pending so the confirm path is exercised deterministically.
    await waitForVoiceStatus(noteId, ALICE, "draft_ready");
    const note = await repo.findById(ws.value, noteId);
    if (!note) throw new Error("note missing after upload");
    note.resetToPending(new Date());
    await repo.save(note);

    const res = await json(`/api/v1/voices/${noteId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: "acc-anything",
        type: "expense",
        idempotencyKey: `e2e-vpending-${randomUUID()}`,
        splits: [{ categoryId: null, amountMinorUnits: 100 }],
      },
    });

    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("VOICE_NOT_READY");
  });

  it("reject discards a draft_ready note; a confirmed note cannot be rejected", async () => {
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;
    await waitForVoiceStatus(noteId, ALICE, "draft_ready");

    const rejected = await json(`/api/v1/voices/${noteId}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(rejected.status).toBe(200);
    expect((rejected.body as { status: string }).status).toBe("rejected");

    // Terminal notes cannot be rejected again.
    const again = await json(`/api/v1/voices/${noteId}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe(
      "VOICE_ALREADY_FINAL",
    );

    // A confirmed note is terminal too.
    const upload2 = await uploadVoice(ALICE);
    const noteId2 = upload2.body.id as string;
    await waitForVoiceStatus(noteId2, ALICE, "draft_ready");
    const foodId = await categoryIdByKey(ALICE, "food");
    const confirm = await json(`/api/v1/voices/${noteId2}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: await createPenAccount(),
        type: "expense",
        idempotencyKey: `e2e-vnorej-${randomUUID()}`,
        splits: [{ categoryId: foodId, amountMinorUnits: 1200 }],
      },
    });
    expect(confirm.status).toBe(201);
    const rejectConfirmed = await json(`/api/v1/voices/${noteId2}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(rejectConfirmed.status).toBe(409);
    expect((rejectConfirmed.body as { code: string }).code).toBe(
      "VOICE_ALREADY_FINAL",
    );
  });

  it("retry re-queues a failed note over the same storageKey and the inline pipeline reaches draft_ready again", async () => {
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    const ws = WorkspaceId.create(wsId);
    if (!ws.ok) throw ws.error;
    const repo = new DrizzleVoiceNoteRepository(db);

    await waitForVoiceStatus(noteId, ALICE, "draft_ready");

    // Force the terminal failure exactly how the worker persists it.
    const failed = await repo.findById(ws.value, noteId);
    if (!failed) throw new Error("note missing after upload");
    const storageKey = failed.storageKey;
    failed.markFailed("forced pipeline failure", new Date());
    await repo.save(failed);

    const retry = await json(`/api/v1/voices/${noteId}/retry`, {
      method: "POST",
      headers: ALICE,
    });
    expect(retry.status).toBe(200);
    expect((retry.body as { status: string }).status).toBe("pending");

    // Same row back to pending over the original storageKey — no new file.
    const reloaded = await repo.findById(ws.value, noteId);
    expect(reloaded?.status).toBe("pending");
    expect(reloaded?.error).toBeNull();
    expect(reloaded?.storageKey).toBe(storageKey);

    // The inline dispatcher re-ran the job: poll until draft_ready.
    const done = await waitForVoiceStatus(noteId, ALICE, "draft_ready");
    expect(done.status).toBe("draft_ready");

    // A user-final note conflicts instead of re-queueing.
    const final = await repo.findById(ws.value, noteId);
    if (!final) throw new Error("note missing after draft_ready");
    final.markRejected(new Date());
    await repo.save(final);
    const conflict = await json(`/api/v1/voices/${noteId}/retry`, {
      method: "POST",
      headers: ALICE,
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as { code: string }).code).toBe(
      "VOICE_ALREADY_FINAL",
    );
  });

  it("a foreign workspace cannot read, confirm or reject the note", async () => {
    const upload = await uploadVoice(ALICE);
    const noteId = upload.body.id as string;
    await waitForVoiceStatus(noteId, ALICE, "draft_ready");

    const draft = await json(`/api/v1/voices/${noteId}/draft`, {
      headers: BOB,
    });
    expect(draft.status).toBe(404);
    const confirm = await json(`/api/v1/voices/${noteId}/confirm`, {
      method: "POST",
      headers: BOB,
      body: {
        accountId: "acc-x",
        type: "expense",
        idempotencyKey: `e2e-vforeign-${randomUUID()}`,
        splits: [{ categoryId: null, amountMinorUnits: 100 }],
      },
    });
    expect(confirm.status).toBe(404);
    const reject = await json(`/api/v1/voices/${noteId}/reject`, {
      method: "POST",
      headers: BOB,
    });
    expect(reject.status).toBe(404);
    const retry = await json(`/api/v1/voices/${noteId}/retry`, {
      method: "POST",
      headers: BOB,
    });
    expect(retry.status).toBe(404);
  });
});

// Root-level: the shared test pool outlives every describe's cleanup.
afterAll(async () => {
  await closeTestDb();
});
