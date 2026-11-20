import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanE2eData,
  closeTestDb,
  db,
} from "../../test/e2e-helpers.js";
import {
  categories,
  receiptScans,
  workspaces,
} from "../drizzle/schema.js";
import { buildApp, envFromProcess } from "./composition.js";
import { handleReceiptScan } from "../jobs/receipt-scan.js";
import { SystemClock } from "../modules/ledger/infrastructure/system-clock.adapter.js";
import { DrizzleCategoryValidationAdapter } from "../modules/categorization/index.js";
import {
  DrizzleReceiptScanRepository,
  LocalReceiptStorage,
  type ReceiptScanPort,
} from "../modules/receipts/index.js";
import { ok, WorkspaceId } from "../modules/shared-kernel/index.js";

/**
 * Receipt draft approval e2e (receipt-scan-drafts T6, S2+S4+S7+S10):
 * real HTTP + Postgres round-trip — multipart upload → worker pipeline
 * driven by a fake ReceiptScanPort → draft GET → confirm → transaction
 * with splits and the scan linked as confirmed. Covers the splits e2e
 * debt left by T2 through the confirm path.
 */

const MARKER = "|e2e-rcpt-";
const ALICE = { "x-dev-user": "e2e-rcpt-alice" };
const BOB = { "x-dev-user": "e2e-rcpt-bob" };
// T5 (S4): a fresh identity → a workspace holding ONLY this spec's
// scans, so cursor walks end at a deterministic nextCursor=null.
const CAROL = { "x-dev-user": "e2e-rcpt-carol" };

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

let baseUrl = "";
let storageDir = "";
let closeApp: () => Promise<void>;

/** Deterministic fake scanner: a merchant + three categorized items. */
const fakeScanner: ReceiptScanPort = {
  scan: async () =>
    ok({
      merchant: "Bodega Central",
      businessDate: "2026-11-10",
      currency: "PEN",
      totalMinorUnits: 3550,
      items: [
        {
          description: "Arroz",
          amountMinorUnits: 2000,
          suggestedCategoryKey: "food",
          suggestedNewCategory: null,
          confidence: 0.95,
        },
        {
          description: "Shampoo",
          amountMinorUnits: 1000,
          suggestedCategoryKey: null,
          suggestedNewCategory: { name: "Cuidado personal", nature: "essential" },
          confidence: 0.8,
        },
        {
          description: "Item raro",
          amountMinorUnits: 550,
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
    base?: string;
  } = {},
): Promise<ApiJson> {
  const res = await fetch(`${options.base ?? baseUrl}${path}`, {
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

async function uploadReceipt(
  headers: Record<string, string>,
  bytes: Uint8Array = uniqueJpeg(),
  base: string = baseUrl,
) {
  const form = new FormData();
  form.append("file", new File([bytes], "ticket.jpg", { type: "image/jpeg" }));
  const res = await fetch(`${base}/api/v1/receipts`, {
    method: "POST",
    headers,
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * T13 (S12): every test upload carries distinct trailing bytes so the
 * fileHash differs — the dedup test below is the only case that uploads
 * the SAME bytes twice. The JPEG signature is in the header, so the
 * appended tag keeps the sniffed mime image/jpeg.
 */
function uniqueJpeg(tag: string = randomUUID()): Uint8Array {
  return Uint8Array.from([...JPEG, ...new TextEncoder().encode(tag)]);
}

/** Stored quarantine objects under the local driver dir. */
function storedFileCount(): number {
  return readdirSync(storageDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
}

/** Rows enqueued for one scan on the receipt-scan pg-boss queue. */
async function countScanJobs(receiptId: string): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from pgboss.job
    where name = 'receipt-scan'
      and data->>'receiptId' = ${receiptId}
  `);
  const row = Array.isArray(rows) ? rows[0] : rows.rows[0];
  return Number(row?.count ?? 0);
}

/**
 * T14 (S13): countScanJobs variant that tolerates a database where the
 * pgboss schema was never created (inline dispatcher, no worker ever
 * booted) — a missing queue table means zero enqueued jobs.
 */
async function countScanJobsIfQueueExists(receiptId: string): Promise<number> {
  try {
    return await countScanJobs(receiptId);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return 0; // undefined_table
    throw error;
  }
}

/** Polls GET /receipts/:id until it reports `wanted` (T14 inline pipeline). */
async function waitForScanStatus(
  base: string,
  scanId: string,
  headers: Record<string, string>,
  wanted: string,
  timeoutMs: number,
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string } | null = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v1/receipts/${scanId}`, { headers });
    last = (await res.json()) as { status: string };
    if (last.status === wanted) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `scan ${scanId} never reached ${wanted}; last=${JSON.stringify(last)}`,
  );
}

/** Drives the worker pipeline for one scan with the fake port. */
async function runScanJob(receiptId: string, workspaceId: string): Promise<void> {
  await handleReceiptScan(
    {
      scans: new DrizzleReceiptScanRepository(db),
      storage: new LocalReceiptStorage(storageDir),
      categories: new DrizzleCategoryValidationAdapter(db),
      scanner: fakeScanner,
      clock: new SystemClock(),
    },
    { receiptId, workspaceId },
  );
}

async function workspaceIdOf(headers: Record<string, string>): Promise<string> {
  // Any authenticated call resolves (and lazily creates) the workspace;
  // the cheapest read is the categories list.
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

async function cleanupScans(): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%${MARKER}%`));
  const ids = owned.map((w) => w.id);
  if (ids.length > 0) {
    await db
      .delete(receiptScans)
      .where(inArray(receiptScans.workspaceId, ids));
  }
}

describe("receipt draft review + confirm e2e (T6, S2+S4+S7+S10)", () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), "tfm-receipts-e2e-"));
    process.env.DATABASE_URL ??= DATABASE_URL;
    process.env.AUTH_MODE ??= "dev";
    process.env.RATE_LIMIT_MAX ??= "100000";
    process.env.STORAGE_DRIVER = "local";
    process.env.RECEIPT_STORAGE_DIR = storageDir;
    const built = buildApp(envFromProcess());
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
    await cleanupScans();
  });

  afterAll(async () => {
    await cleanupScans();
    await cleanE2eData(MARKER);
    // The system fallback this suite may have lazily provisioned.
    await db
      .delete(categories)
      .where(eq(categories.id, "sys-uncategorized"));
    await closeApp();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("upload → fake scan → draft → confirm creates a split transaction (origin ticket)", async () => {
    const upload = await uploadReceipt(ALICE);
    expect(upload.status).toBe(201);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    expect(upload.body.status).toBe("pending");

    // The draft is not reviewable while the pipeline is still pending.
    const early = await json(`/api/v1/receipts/${scanId}/draft`, { headers: ALICE });
    expect(early.status).toBe(409);
    expect((early.body as { code: string }).code).toBe("RECEIPT_NOT_READY");

    await runScanJob(scanId, wsId);

    const scan = await json(`/api/v1/receipts/${scanId}`, { headers: ALICE });
    expect((scan.body as { status: string }).status).toBe("draft_ready");

    // T13 (S12): a same-amount same-merchant expense already recorded →
    // the draft read flags it as a possible duplicate (computed fresh).
    const prior = await json("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: {
        type: "expense",
        amount: "35.50",
        currency: "PEN",
        businessDate: "2026-11-10",
        timezone: "UTC",
        concept: "Bodega Central",
        accountId: await createPenAccount(),
        idempotencyKey: `e2e-dup-${randomUUID()}`,
      },
    });
    expect(prior.status).toBe(201);
    const priorTxId = (prior.body as { id: string }).id;

    const draft = await json(`/api/v1/receipts/${scanId}/draft`, { headers: ALICE });
    expect(draft.status).toBe(200);
    const payload = draft.body as {
      merchant: string;
      concept: string;
      businessDate: string;
      currency: string;
      splits: Array<{
        categoryKey: string | null;
        newCategory: { name: string; nature: string } | null;
        amountMinorUnits: number;
      }>;
      possibleDuplicates: Array<{
        transactionId: string;
        concept: string;
        amount: number;
        occurredOn: string;
      }>;
    };
    expect(payload.merchant).toBe("Bodega Central");
    expect(payload.splits).toHaveLength(3);
    expect(payload.possibleDuplicates).toEqual([
      {
        transactionId: priorTxId,
        concept: "Bodega Central",
        amount: 3550,
        occurredOn: "2026-11-10",
      },
    ]);

    const foodId = await categoryIdByKey(ALICE, "food");
    const confirm = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: await createPenAccount(),
        type: "expense",
        idempotencyKey: `e2e-confirm-${randomUUID()}`,
        splits: [
          { categoryId: foodId, amountMinorUnits: 2000 },
          {
            newCategory: { name: "Cuidado personal", nature: "essential" },
            amountMinorUnits: 1000,
          },
          { categoryId: null, amountMinorUnits: 550 },
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
    expect(confirmed.transaction.origin).toBe("ticket");
    // receipt-review-link T2 (S2): the ticket↔movement link is
    // serialized — the scan id survives as originReference.
    expect(confirmed.transaction.originReference).toBe(scanId);
    expect(confirmed.transaction.concept).toBe("Bodega Central");
    expect(confirmed.transaction.splits).toHaveLength(3);
    expect(
      confirmed.transaction.splits.reduce(
        (sum, s) => sum + Number.parseFloat(s.amount),
        0,
      ),
    ).toBeCloseTo(35.5, 2);
    // S10: only the approved newCategory was created and reported.
    expect(confirmed.createdCategories.map((c) => c.key)).toEqual([
      "cuidado_personal",
    ]);

    // The scan is now confirmed and linked to the transaction.
    const after = await json(`/api/v1/receipts/${scanId}`, { headers: ALICE });
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

    // The uncategorized split points at a real category row (system fallback).
    const uncategorizedSplit = confirmed.transaction.splits.find(
      (s) => s.amount === "5.50",
    )!;
    const [uncatRow] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, uncategorizedSplit.categoryId));
    expect(uncatRow?.key).toBe("uncategorized");
    expect(uncatRow?.workspaceId).toBeNull();
  });

  it("GET /api/v1/receipts lists the workspace scans newest first (receipt-review-link T1, S1)", async () => {
    const upload = await uploadReceipt(ALICE);
    expect(upload.status).toBe(201);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);

    // Before confirm the scan is listed with a null transactionId.
    // T5 (S4): the list is a paginated envelope, not a bare array.
    const before = await json("/api/v1/receipts", { headers: ALICE });
    expect(before.status).toBe(200);
    const pageBefore = before.body as unknown as {
      items: Array<{
        id: string;
        status: string;
        originalFilename: string;
        fileMimeType: string;
        createdAt: string;
        transactionId: string | null;
      }>;
      nextCursor: string | null;
    };
    const itemsBefore = pageBefore.items;
    expect(Array.isArray(itemsBefore)).toBe(true);
    const pendingItem = itemsBefore.find((item) => item.id === scanId);
    expect(pendingItem).toBeDefined();
    expect(pendingItem!.transactionId).toBeNull();

    // Newest-first ordering across the whole workspace list.
    const timestamps = itemsBefore.map((item) => Date.parse(item.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    await runScanJob(scanId, wsId);
    const foodId = await categoryIdByKey(ALICE, "food");
    const confirm = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: await createPenAccount(),
        type: "expense",
        idempotencyKey: `e2e-list-${randomUUID()}`,
        splits: [{ categoryId: foodId, amountMinorUnits: 3550 }],
      },
    });
    expect(confirm.status).toBe(201);
    const transaction = (
      confirm.body as { transaction: { id: string } }
    ).transaction;

    // After confirm the same list item carries the transaction link.
    const after = await json("/api/v1/receipts", { headers: ALICE });
    const itemsAfter = (after.body as unknown as typeof pageBefore).items;
    const confirmedItem = itemsAfter.find((item) => item.id === scanId);
    expect(confirmedItem).toBeDefined();
    // receipt-retention-30d T1 (S2): the list contract gained
    // expiresAt/mediaDeletedAt — the key set is asserted exactly so a
    // shape drift fails here.
    expect(Object.keys(confirmedItem!).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "fileMimeType",
      "id",
      "mediaDeletedAt",
      "originalFilename",
      "status",
      "transactionId",
    ]);
    expect(confirmedItem).toMatchObject({
      id: scanId,
      status: "confirmed",
      originalFilename: "ticket.jpg",
      fileMimeType: "image/jpeg",
      transactionId: transaction.id,
    });

    // Workspace isolation: BOB has no scans and sees an empty page.
    const foreign = await json("/api/v1/receipts", { headers: BOB });
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual({ items: [], nextCursor: null });
  });

  it("GET /api/v1/receipts paginates with an opaque cursor — page 2 continues without overlap and ends nextCursor=null (receipt-review-link T5, S4)", async () => {
    // CAROL's workspace holds exactly the three scans uploaded here.
    const uploaded: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const upload = await uploadReceipt(CAROL);
      expect(upload.status).toBe(201);
      uploaded.push(upload.body.id as string);
    }

    const page1 = await json("/api/v1/receipts?limit=2", { headers: CAROL });
    expect(page1.status).toBe(200);
    const first = page1.body as unknown as {
      items: Array<{ id: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(2);
    expect(typeof first.nextCursor).toBe("string");

    const page2 = await json(
      `/api/v1/receipts?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: CAROL },
    );
    expect(page2.status).toBe(200);
    const second = page2.body as unknown as typeof first;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    // No overlap, no gaps: the walk covers exactly the three uploads,
    // newest-first (upload order reversed under equal-ms createdAt is
    // still a total order via the id tiebreak — assert disjoint sets).
    const walked = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(walked).size).toBe(3);
    expect([...walked].sort()).toEqual([...uploaded].sort());
    const stamps = [...first.items, ...second.items].map((i) =>
      Date.parse(i.createdAt),
    );
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    // Pinned validation: bad cursor → 400 INVALID_CURSOR; bad limit →
    // 400 INVALID_QUERY (never clamped, never silently empty).
    const badCursor = await json("/api/v1/receipts?cursor=%%%", {
      headers: CAROL,
    });
    expect(badCursor.status).toBe(400);
    expect((badCursor.body as { code: string }).code).toBe("INVALID_CURSOR");
    const badLimit = await json("/api/v1/receipts?limit=0", {
      headers: CAROL,
    });
    expect(badLimit.status).toBe(400);
    expect((badLimit.body as { code: string }).code).toBe("INVALID_QUERY");
  });

  it("replaying the same confirm returns the same transaction without duplicates", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    await runScanJob(scanId, wsId);
    const foodId = await categoryIdByKey(ALICE, "food");
    const key = `e2e-replay-${randomUUID()}`;
    const body = {
      accountId: await createPenAccount(),
      type: "expense",
      idempotencyKey: key,
      splits: [
        { categoryId: foodId, amountMinorUnits: 2000 },
        {
          newCategory: { name: "Replay cat", nature: "discretionary" },
          amountMinorUnits: 1550,
        },
      ],
    };

    const first = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body,
    });
    expect(first.status).toBe(201);
    const firstTx = (first.body as { transaction: { id: string } }).transaction;

    const replay = await json(`/api/v1/receipts/${scanId}/confirm`, {
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
      .where(eq(categories.key, "replay_cat"));
    expect(created).toHaveLength(1);
    const txs = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.id, scanId));
    expect(txs[0]!.transactionId).toBe(firstTx.id);
  });

  it("confirm on a pending scan returns 409 and leaves no side effects", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;

    const res = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: "acc-anything",
        type: "expense",
        idempotencyKey: `e2e-pending-${randomUUID()}`,
        splits: [{ categoryId: null, amountMinorUnits: 100 }],
      },
    });

    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("RECEIPT_NOT_READY");
  });

  it("reject discards a pending scan; a confirmed scan cannot be rejected", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);

    const rejected = await json(`/api/v1/receipts/${scanId}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(rejected.status).toBe(200);
    expect((rejected.body as { status: string }).status).toBe("rejected");

    // Terminal scans cannot be rejected again.
    const again = await json(`/api/v1/receipts/${scanId}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(again.status).toBe(409);

    // A confirmed scan is terminal too.
    const upload2 = await uploadReceipt(ALICE);
    const scanId2 = upload2.body.id as string;
    await runScanJob(scanId2, wsId);
    const foodId = await categoryIdByKey(ALICE, "food");
    const confirm = await json(`/api/v1/receipts/${scanId2}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: await createPenAccount(),
        type: "expense",
        idempotencyKey: `e2e-norej-${randomUUID()}`,
        splits: [{ categoryId: foodId, amountMinorUnits: 1200 }],
      },
    });
    expect(confirm.status).toBe(201);
    const rejectConfirmed = await json(`/api/v1/receipts/${scanId2}/reject`, {
      method: "POST",
      headers: ALICE,
    });
    expect(rejectConfirmed.status).toBe(409);
    expect((rejectConfirmed.body as { code: string }).code).toBe(
      "RECEIPT_ALREADY_FINAL",
    );
  });

  it("retry re-queues a failed scan over the same storageKey without a new upload (T12, S11)", async () => {
    const upload = await uploadReceipt(ALICE);
    expect(upload.status).toBe(201);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    const ws = WorkspaceId.create(wsId);
    if (!ws.ok) throw ws.error;

    // Force the terminal failure exactly how the worker persists it.
    const repo = new DrizzleReceiptScanRepository(db);
    const failed = await repo.findById(ws.value, scanId);
    if (!failed) throw new Error("scan missing after upload");
    const storageKey = failed.storageKey;
    failed.markFailed("forced pipeline failure", new Date());
    await repo.save(failed);

    const jobsBefore = await countScanJobs(scanId);

    const retry = await json(`/api/v1/receipts/${scanId}/retry`, {
      method: "POST",
      headers: ALICE,
    });
    expect(retry.status).toBe(200);
    expect((retry.body as { status: string }).status).toBe("pending");

    // Same row back to pending over the original storageKey — no new file.
    const reloaded = await repo.findById(ws.value, scanId);
    expect(reloaded?.status).toBe("pending");
    expect(reloaded?.error).toBeNull();
    expect(reloaded?.storageKey).toBe(storageKey);

    // The scan job was re-enqueued: one extra row on the receipt-scan queue.
    expect(await countScanJobs(scanId)).toBe(jobsBefore + 1);

    // The retried job is processable end-to-end and reaches draft_ready.
    await runScanJob(scanId, wsId);
    const done = await json(`/api/v1/receipts/${scanId}`, { headers: ALICE });
    expect((done.body as { status: string }).status).toBe("draft_ready");

    // A user-final scan conflicts instead of re-queueing.
    const final = await repo.findById(ws.value, scanId);
    if (!final) throw new Error("scan missing after draft_ready");
    final.markRejected(new Date());
    await repo.save(final);
    const conflict = await json(`/api/v1/receipts/${scanId}/retry`, {
      method: "POST",
      headers: ALICE,
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as { code: string }).code).toBe(
      "RECEIPT_ALREADY_FINAL",
    );
  });

  it("duplicate upload of the same bytes returns the same scan — one file, one job (T13, S12)", async () => {
    const bytes = uniqueJpeg("dup-same-voucher");
    const filesBefore = storedFileCount();

    const first = await uploadReceipt(ALICE, bytes);
    const second = await uploadReceipt(ALICE, bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const scanId = first.body.id as string;
    expect(second.body.id).toBe(scanId);

    // One new quarantine object — not two.
    expect(storedFileCount()).toBe(filesBefore + 1);
    // One row for this scan, one enqueued job total.
    const rows = await db
      .select({ id: receiptScans.id })
      .from(receiptScans)
      .where(eq(receiptScans.id, scanId));
    expect(rows).toHaveLength(1);
    expect(await countScanJobs(scanId)).toBe(1);
  });

  it("a foreign workspace cannot see, confirm or reject the scan", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);
    await runScanJob(scanId, wsId);

    const draft = await json(`/api/v1/receipts/${scanId}/draft`, { headers: BOB });
    expect(draft.status).toBe(404);
    const confirm = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: BOB,
      body: {
        accountId: "acc-x",
        type: "expense",
        idempotencyKey: `e2e-foreign-${randomUUID()}`,
        splits: [{ categoryId: null, amountMinorUnits: 100 }],
      },
    });
    expect(confirm.status).toBe(404);
    const reject = await json(`/api/v1/receipts/${scanId}/reject`, {
      method: "POST",
      headers: BOB,
    });
    expect(reject.status).toBe(404);
  });
});

describe("inline scan dispatcher e2e (T14, S13)", () => {
  let inlineUrl = "";
  let inlineStorageDir = "";
  let closeInline: () => Promise<void>;

  beforeAll(async () => {
    inlineStorageDir = mkdtempSync(join(tmpdir(), "tfm-receipts-inline-"));
    // envFromProcess parses the dispatcher selector at boot; the fake
    // scanner is injected through the AppEnv seam below so no Gemini
    // call is made. GEMINI_API_KEY is still required — the API must
    // fail fast without it exactly like the worker does.
    const savedDispatcher = process.env.RECEIPT_SCAN_DISPATCHER;
    const savedApiKey = process.env.GEMINI_API_KEY;
    process.env.RECEIPT_SCAN_DISPATCHER = "inline";
    process.env.GEMINI_API_KEY = "e2e-inline-fake-key";
    try {
      const env = envFromProcess();
      const scanDispatcher = env.receipts.scanDispatcher;
      if (scanDispatcher.mode !== "inline") {
        throw new Error("RECEIPT_SCAN_DISPATCHER=inline was not parsed");
      }
      const built = buildApp({
        ...env,
        receipts: {
          ...env.receipts,
          storage: { driver: "local", dir: inlineStorageDir },
          scanDispatcher: { ...scanDispatcher, scanner: fakeScanner },
        },
      });
      const server = serve({ fetch: built.app.fetch, port: 0 });
      const address = server.address() as AddressInfo;
      inlineUrl = `http://127.0.0.1:${address.port}`;
      closeInline = async () => {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await built.close();
      };
    } finally {
      if (savedDispatcher === undefined) delete process.env.RECEIPT_SCAN_DISPATCHER;
      else process.env.RECEIPT_SCAN_DISPATCHER = savedDispatcher;
      if (savedApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedApiKey;
    }
    await cleanE2eData(MARKER);
    await cleanupScans();
  });

  afterAll(async () => {
    await cleanupScans();
    await cleanE2eData(MARKER);
    await closeInline();
    rmSync(inlineStorageDir, { recursive: true, force: true });
  });

  it("upload → in-process scan reaches draft_ready with no worker and no queued job", async () => {
    const upload = await uploadReceipt(ALICE, uniqueJpeg(), inlineUrl);
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe("pending");
    const scanId = upload.body.id as string;

    // Nothing was enqueued — the pipeline runs in this same process.
    expect(await countScanJobsIfQueueExists(scanId)).toBe(0);

    // The API contract is unchanged: poll the same scan until the
    // inline pipeline persists draft_ready.
    const scan = await waitForScanStatus(
      inlineUrl,
      scanId,
      ALICE,
      "draft_ready",
      10_000,
    );
    expect(scan.status).toBe("draft_ready");

    const draft = await json(`/api/v1/receipts/${scanId}/draft`, {
      headers: ALICE,
      base: inlineUrl,
    });
    expect(draft.status).toBe(200);
    expect((draft.body as { merchant: string }).merchant).toBe(
      "Bodega Central",
    );
    expect(
      (draft.body as { splits: unknown[] }).splits,
    ).toHaveLength(3);
  });
});

// Root-level: the shared test pool outlives every describe's cleanup.
afterAll(async () => {
  await closeTestDb();
});

async function createPenAccount(): Promise<string> {
  const res = await json("/api/v1/accounts", {
    method: "POST",
    headers: ALICE,
    body: { name: `e2e-rcpt-${randomUUID()}`, currency: "PEN" },
  });
  return (res.body as { id: string }).id;
}
