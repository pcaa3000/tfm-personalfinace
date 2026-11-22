import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { voiceConsents } from "./schema.js";

/**
 * voice-drafts T5 (S6) structural guards: migration 0009 creates
 * `voices_voice_consents` — the persisted provider-consent record with
 * grantedAt/revokedAt instants (both nullable: a refusal has no grant)
 * and the UNIQUE(workspaceId, subject, provider) upsert key. Verified
 * from the generated SQL + the Drizzle table definition — a
 * regenerated migration must keep them or the consent contract breaks.
 */
const dir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const read = (rel: string): string => readFileSync(`${dir}${rel}`, "utf8");

const migrationFile = readdirSync(dir).find((f) => /^0009_.*\.sql$/.test(f));
const migrationSql = migrationFile ? read(migrationFile).trim() : null;

describe("voices_voice_consents migration (voice-drafts T5, S6)", () => {
  it("journal registers a 0009_* migration", () => {
    const { entries } = JSON.parse(read("meta/_journal.json")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = entries.find((e) => e.idx === 9);
    expect(entry).toBeDefined();
    expect(entry?.tag).toMatch(/^0009_/);
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });

  it("creates voices_voice_consents with provider + both decision instants", () => {
    expect(migrationFile).toBeDefined();
    const sql = migrationSql ?? "";
    expect(sql).toContain('CREATE TABLE "voices_voice_consents"');
    for (const column of [
      '"workspaceId" text',
      '"subject" text',
      '"provider" text',
      '"grantedAt" timestamp (3)',
      '"revokedAt" timestamp (3)',
    ]) {
      expect(sql).toContain(column);
    }
    // S6/docs/05: both instants are nullable — an explicit refusal has
    // revokedAt without a grant; an active consent has grantedAt
    // without revokedAt.
    expect(sql).not.toContain('"grantedAt" timestamp (3) NOT NULL');
    expect(sql).not.toContain('"revokedAt" timestamp (3) NOT NULL');
  });

  it("creates the UNIQUE(workspaceId, subject, provider) upsert key", () => {
    const sql = migrationSql ?? "";
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "voices_voice_consents_workspaceId_subject_provider_key"/,
    );
    expect(sql).toMatch(/"workspaceId",\s*"subject",\s*"provider"/);
  });

  it("the Drizzle table definition mirrors the migrated columns", () => {
    const columns = Object.keys(getTableColumns(voiceConsents));
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "subject",
        "provider",
        "grantedAt",
        "revokedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(getTableColumns(voiceConsents).grantedAt.notNull).toBe(false);
    expect(getTableColumns(voiceConsents).revokedAt.notNull).toBe(false);
    expect(getTableColumns(voiceConsents).provider.notNull).toBe(true);
  });
});
