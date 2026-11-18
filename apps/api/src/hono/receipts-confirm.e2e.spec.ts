import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { eq, inArray, like } from "drizzle-orm";
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
import { ok } from "../modules/shared-kernel/index.js";

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
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
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

async function uploadReceipt(headers: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([JPEG], "ticket.jpg", { type: "image/jpeg" }));
  const res = await fetch(`${baseUrl}/api/v1/receipts`, {
    method: "POST",
    headers,
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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
    await closeTestDb();
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
    };
    expect(payload.merchant).toBe("Bodega Central");
    expect(payload.splits).toHaveLength(3);

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
        concept: string;
        splits: Array<{ categoryId: string; amount: string }>;
      };
      createdCategories: Array<{ key: string }>;
    };
    expect(confirmed.transaction.type).toBe("expense");
    expect(confirmed.transaction.amount).toBe("35.50");
    expect(confirmed.transaction.currency).toBe("PEN");
    expect(confirmed.transaction.origin).toBe("ticket");
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

async function createPenAccount(): Promise<string> {
  const res = await json("/api/v1/accounts", {
    method: "POST",
    headers: ALICE,
    body: { name: `e2e-rcpt-${randomUUID()}`, currency: "PEN" },
  });
  return (res.body as { id: string }).id;
}
