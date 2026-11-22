import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { receiptScans } from "../src/drizzle/schema.js";

/**
 * receipt-retention-30d T1 (S1+S2) structural guards: migration 0007
 * adds `expiresAt` (NOT NULL, backfilled `createdAt + interval '30 days'`)
 * and `mediaDeletedAt` (nullable) to `receipts_receipt_scans`. The
 * backfill is verified from the migration SQL text — a regenerated
 * migration must keep it or pre-existing rows would violate NOT NULL.
 */
const dir = fileURLToPath(new URL("../drizzle/", import.meta.url));
const read = (rel: string): string => readFileSync(`${dir}${rel}`, "utf8");

const migrationFile = readdirSync(dir).find((f) => /^0007_.*\.sql$/.test(f));
const migrationSql = migrationFile ? read(migrationFile).trim() : null;

type Col = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string;
};
type Table = { columns: Record<string, Col> };
type Snap = { id: string; prevId: string; tables: Record<string, Table> };
const snap = (file: string): Snap =>
  JSON.parse(read(`meta/${file}`)) as Snap;
const T = "public.receipts_receipt_scans";

describe("receipt media retention migration (S1+S2)", () => {
  it("journal registers a 0007_* migration and stays contiguous at the head", () => {
    const { entries } = JSON.parse(read("meta/_journal.json")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    // voice-drafts T1 added 0008 — the retention guard only pins that
    // 0007 remains registered and the journal stays gapless.
    expect(entries.some((e) => e.idx === 7 && /^0007_/.test(e.tag))).toBe(
      true,
    );
    expect(entries.at(-1)?.idx).toBe(entries.length - 1);
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });

  it("0007 adds expiresAt + mediaDeletedAt and backfills expiresAt from createdAt + 30 days", () => {
    expect(migrationFile).toBeDefined();
    const sql = migrationSql ?? "";
    // Backfill comment: expires_at is NOT NULL, so existing rows must be
    // filled before the constraint lands — verified here via SQL text.
    expect(sql).toContain(
      'ALTER TABLE "receipts_receipt_scans" ADD COLUMN "expiresAt" timestamp (3)',
    );
    expect(sql).toContain(
      'ALTER TABLE "receipts_receipt_scans" ADD COLUMN "mediaDeletedAt" timestamp (3)',
    );
    expect(sql).toMatch(
      /UPDATE\s+"receipts_receipt_scans"\s+SET\s+"expiresAt"\s*=\s*"createdAt"\s*\+\s*interval\s+'30 days'/i,
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+"receipts_receipt_scans"\s+ALTER\s+COLUMN\s+"expiresAt"\s+SET\s+NOT\s+NULL/i,
    );
    // mediaDeletedAt stays nullable — no NOT NULL on it.
    expect(sql).not.toMatch(/"mediaDeletedAt"[^;]*NOT NULL/i);
  });

  it("snapshot 0007 persists expiresAt NOT NULL and mediaDeletedAt nullable", () => {
    const table = snap("0007_snapshot.json").tables[T];
    if (!table) throw new Error("receipt_scans table missing in snapshot");
    expect(table.columns.expiresAt).toMatchObject({
      name: "expiresAt",
      notNull: true,
    });
    expect(table.columns.mediaDeletedAt).toMatchObject({
      name: "mediaDeletedAt",
      notNull: false,
    });
  });

  it("schema.ts declares both columns and matches snapshot 0007", () => {
    const cols = getTableColumns(receiptScans);
    const snapCols = snap("0007_snapshot.json").tables[T]?.columns;
    if (!snapCols) throw new Error("receipt_scans table missing in snapshot");
    expect(cols.expiresAt.notNull).toBe(true);
    expect(cols.mediaDeletedAt.notNull).toBe(false);
    expect(Object.keys(cols).sort()).toEqual(Object.keys(snapCols).sort());
  });
});
