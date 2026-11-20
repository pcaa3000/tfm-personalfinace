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
  ledgerTransactions,
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
 * Early media deletion e2e (receipt-retention-30d T3, S3, CA-012):
 * real HTTP + Postgres + local fs storage — DELETE removes only the
 * object, GET file then answers 410, the scan row and its confirmed
 * transaction survive, and a repeated DELETE stays 204 (idempotent).
 */

const MARKER = "|e2e-rcmedia-";
const ALICE = { "x-dev-user": "e2e-rcmedia-alice" };
const BOB = { "x-dev-user": "e2e-rcmedia-bob" };

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

let baseUrl = "";
let storageDir = "";
let closeApp: () => Promise<void>;

const fakeScanner: ReceiptScanPort = {
  scan: async () =>
    ok({
      merchant: "Bodega Central",
      businessDate: "2026-11-10",
      currency: "PEN",
      totalMinorUnits: 1000,
      items: [
        {
          description: "Arroz",
          amountMinorUnits: 1000,
          suggestedCategoryKey: "food",
          suggestedNewCategory: null,
          confidence: 0.95,
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
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function uploadReceipt(headers: Record<string, string>) {
  const form = new FormData();
  form.append(
    "file",
    new File([Uint8Array.from([...JPEG, ...new TextEncoder().encode(randomUUID())])], "ticket.jpg", {
      type: "image/jpeg",
    }),
  );
  const res = await fetch(`${baseUrl}/api/v1/receipts`, {
    method: "POST",
    headers,
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function workspaceIdOf(headers: Record<string, string>): Promise<string> {
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

describe("receipt media deletion e2e (receipt-retention-30d T3, S3, CA-012)", () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), "tfm-rcmedia-e2e-"));
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
    // No sys-uncategorized cleanup here: it is shared seed data other
    // parallel suites may still reference — the confirm e2e owns it.
    await closeApp();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("DELETE → 204 → GET file 410 → repeat DELETE 204; scan row + confirmed transaction survive", async () => {
    const upload = await uploadReceipt(ALICE);
    expect(upload.status).toBe(201);
    const scanId = upload.body.id as string;
    const wsId = await workspaceIdOf(ALICE);

    // The upload view exposes the fixed 30-day expiry + live media.
    expect(upload.body.expiresAt).toBe(
      new Date(
        Date.parse(upload.body.createdAt as string) + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(upload.body.mediaDeletedAt).toBeNull();

    // GET file serves the bytes while media exists.
    const before = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      headers: ALICE,
    });
    expect(before.status).toBe(200);
    expect(before.headers.get("content-type")).toContain("image/jpeg");

    // Drive the pipeline to draft_ready and confirm so the scan is
    // linked to a real transaction (CA-012 preservation check).
    await runScanJob(scanId, wsId);
    const categories = await json("/api/v1/categories", { headers: ALICE });
    const foodId = (categories.body as unknown as Array<{ id: string; key: string }>)
      .find((c) => c.key === "food")!.id;
    const account = await json("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: `e2e-rcmedia-${randomUUID()}`, currency: "PEN" },
    });
    const confirm = await json(`/api/v1/receipts/${scanId}/confirm`, {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: (account.body as { id: string }).id,
        type: "expense",
        idempotencyKey: `e2e-rcmedia-${randomUUID()}`,
        splits: [{ categoryId: foodId, amountMinorUnits: 1000 }],
      },
    });
    expect(confirm.status).toBe(201);
    const transactionId = (
      confirm.body as { transaction: { id: string } }
    ).transaction.id;

    // DELETE removes ONLY the medium — 204 and idempotent.
    const del = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      method: "DELETE",
      headers: ALICE,
    });
    expect(del.status).toBe(204);

    // The storage object is really gone.
    const [row] = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.id, scanId));
    expect(row?.mediaDeletedAt).not.toBeNull();
    const local = new LocalReceiptStorage(storageDir);
    expect(await local.open(row!.storageKey)).toBeNull();

    // GET file answers 410 — media gone, distinct from 404 scan-not-found.
    const gone = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      headers: ALICE,
    });
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { code: string }).code).toBe(
      "RECEIPT_MEDIA_DELETED",
    );

    // Repeat DELETE stays 204 (idempotent).
    const again = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      method: "DELETE",
      headers: ALICE,
    });
    expect(again.status).toBe(204);

    // CA-012: the scan row keeps status confirmed and its transaction link…
    const scan = await json(`/api/v1/receipts/${scanId}`, { headers: ALICE });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({
      status: "confirmed",
      transactionId,
    });
    expect(typeof (scan.body as { mediaDeletedAt: string }).mediaDeletedAt).toBe(
      "string",
    );

    // …and the transaction itself still exists.
    const [trx] = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, transactionId));
    expect(trx).toBeDefined();
    expect(trx?.status).toBe("confirmed");
  });

  it("DELETE on a pending scan works too — media deletion is status-agnostic (S3)", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;

    const del = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      method: "DELETE",
      headers: ALICE,
    });
    expect(del.status).toBe(204);

    const scan = await json(`/api/v1/receipts/${scanId}`, { headers: ALICE });
    expect((scan.body as { status: string }).status).toBe("pending");
    expect(
      (scan.body as { mediaDeletedAt: string | null }).mediaDeletedAt,
    ).not.toBeNull();
  });

  it("GET /receipts exposes expiresAt/mediaDeletedAt on live media and EXCLUDES media-deleted scans (S2+S6)", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;

    const before = await json("/api/v1/receipts", { headers: ALICE });
    const item = (
      before.body as unknown as { items: Array<Record<string, unknown>> }
    ).items.find((i) => i.id === scanId);
    expect(item).toBeDefined();
    expect(typeof item!.expiresAt).toBe("string");
    expect(item!.mediaDeletedAt).toBeNull();

    await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      method: "DELETE",
      headers: ALICE,
    });

    // S6: a scan without its image is never listed again — not on the
    // first page and not inside a keyset walk.
    const after = await json("/api/v1/receipts", { headers: ALICE });
    expect(after.status).toBe(200);
    const items = (
      after.body as unknown as { items: Array<Record<string, unknown>> }
    ).items;
    expect(items.some((i) => i.id === scanId)).toBe(false);
  });

  it("POST /receipts/purge-media deletes only the caller workspace's media older than the window and returns {deleted: n} (S6)", async () => {
    // Alice: one scan aged past the window, one fresh — only the aged
    // one is purged. Bob: an aged scan in ANOTHER workspace the purge
    // must never reach.
    const aliceOld = (await uploadReceipt(ALICE)).body.id as string;
    const aliceFresh = (await uploadReceipt(ALICE)).body.id as string;
    const bobOld = (await uploadReceipt(BOB)).body.id as string;
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db
      .update(receiptScans)
      .set({ createdAt: tenDaysAgo })
      .where(eq(receiptScans.id, aliceOld));
    await db
      .update(receiptScans)
      .set({ createdAt: tenDaysAgo })
      .where(eq(receiptScans.id, bobOld));

    const res = await json("/api/v1/receipts/purge-media", {
      method: "POST",
      headers: ALICE,
      body: { olderThanDays: 7 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });

    const local = new LocalReceiptStorage(storageDir);
    const [oldRow] = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.id, aliceOld));
    expect(oldRow?.mediaDeletedAt).not.toBeNull();
    expect(await local.open(oldRow!.storageKey)).toBeNull();

    // The fresh scan keeps its media; Bob's aged scan is untouched.
    const [freshRow] = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.id, aliceFresh));
    expect(freshRow?.mediaDeletedAt).toBeNull();
    const [bobRow] = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.id, bobOld));
    expect(bobRow?.mediaDeletedAt).toBeNull();
    expect(await local.open(bobRow!.storageKey)).not.toBeNull();

    // The purged scan disappears from the list; the fresh one stays.
    const list = await json("/api/v1/receipts", { headers: ALICE });
    const ids = (
      list.body as unknown as { items: Array<{ id: string }> }
    ).items.map((i) => i.id);
    expect(ids).toContain(aliceFresh);
    expect(ids).not.toContain(aliceOld);

    // Idempotent: a second purge finds nothing.
    const again = await json("/api/v1/receipts/purge-media", {
      method: "POST",
      headers: ALICE,
      body: { olderThanDays: 7 },
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ deleted: 0 });
  });

  it("POST /receipts/purge-media rejects an invalid window with 400 INVALID_PURGE_WINDOW", async () => {
    const res = await json("/api/v1/receipts/purge-media", {
      method: "POST",
      headers: ALICE,
      body: { olderThanDays: 10 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("INVALID_PURGE_WINDOW");
  });

  it("a foreign workspace cannot delete the medium (workspace-scoped)", async () => {
    const upload = await uploadReceipt(ALICE);
    const scanId = upload.body.id as string;

    const del = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      method: "DELETE",
      headers: BOB,
    });
    expect(del.status).toBe(404);

    // Media is still there for the owner.
    const file = await fetch(`${baseUrl}/api/v1/receipts/${scanId}/file`, {
      headers: ALICE,
    });
    expect(file.status).toBe(200);
  });
});

// Root-level: the shared test pool outlives every describe's cleanup.
afterAll(async () => {
  await closeTestDb();
});
