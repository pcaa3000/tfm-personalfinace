import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { voiceNotes } from "./schema.js";

/**
 * voice-drafts T1 (S5+S7) structural guards: migration 0008 creates
 * `voices_voice_notes` — the sibling mirror of `receipts_receipt_scans`
 * with `expiresAt` NOT NULL from day one, `mediaDeletedAt`, a `transcript`
 * column, and the UNIQUE(workspaceId, fileHash) dedup index. Verified
 * from the generated SQL + the Drizzle table definition — a regenerated
 * migration must keep them or the retention/dedup contract breaks.
 */
const dir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const read = (rel: string): string => readFileSync(`${dir}${rel}`, "utf8");

const migrationFile = readdirSync(dir).find((f) => /^0008_.*\.sql$/.test(f));
const migrationSql = migrationFile ? read(migrationFile).trim() : null;

describe("voices_voice_notes migration (voice-drafts T1, S5+S7)", () => {
  it("journal registers a 0008_* migration as the head", () => {
    const { entries } = JSON.parse(read("meta/_journal.json")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    expect(entries.at(-1)?.idx).toBe(8);
    expect(entries.at(-1)?.tag).toMatch(/^0008_/);
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });

  it("creates voices_voice_notes with the mirrored receipt-scan columns plus transcript", () => {
    expect(migrationFile).toBeDefined();
    const sql = migrationSql ?? "";
    expect(sql).toContain('CREATE TABLE "voices_voice_notes"');
    for (const column of [
      '"storageKey" text',
      '"originalFilename" text',
      '"mimeType" text',
      '"sizeBytes" integer',
      '"status" text',
      '"extractedPayload" jsonb',
      '"draftPayload" jsonb',
      '"transactionId" text',
      '"fileHash" text',
      '"expiresAt" timestamp (3)',
      '"mediaDeletedAt" timestamp (3)',
      // S7: the persisted transcript — same sensitivity as the audio.
      '"transcript" text',
      '"workspaceId" text',
      '"uploaderSubject" text',
    ]) {
      expect(sql).toContain(column);
    }
    // S7: expiresAt is NOT NULL from day one — no nullable backfill.
    expect(sql).toContain('"expiresAt" timestamp (3) NOT NULL');
    // The transaction link nulls out if the transaction is deleted.
    expect(sql).toMatch(
      /REFERENCES "public"\."ledger_transactions"\("id"\).*ON DELETE set null/i,
    );
  });

  it("creates the workspace index and the UNIQUE(workspaceId, fileHash) dedup index", () => {
    const sql = migrationSql ?? "";
    expect(sql).toContain("voices_voice_notes_workspaceId_idx");
    expect(sql).toMatch(/CREATE UNIQUE INDEX "voices_voice_notes_workspaceId_fileHash_key"/);
    expect(sql).toMatch(/"workspaceId",\s*"fileHash"/);
  });

  it("the Drizzle table definition mirrors the migrated columns", () => {
    const columns = Object.keys(getTableColumns(voiceNotes));
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "uploaderSubject",
        "storageKey",
        "originalFilename",
        "mimeType",
        "sizeBytes",
        "status",
        "extractedPayload",
        "draftPayload",
        "transactionId",
        "fileHash",
        "transcript",
        "error",
        "expiresAt",
        "mediaDeletedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(getTableColumns(voiceNotes).expiresAt.notNull).toBe(true);
    expect(getTableColumns(voiceNotes).transcript.notNull).toBe(false);
  });
});
