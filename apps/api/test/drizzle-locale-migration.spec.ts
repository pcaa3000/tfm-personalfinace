import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { workspaces } from "../src/drizzle/schema.js";

// S1/T3 structural guards: the locale drop must survive regeneration and must
// not carry unrelated DDL. Fails before `db:migrate` instead of on a real DB.
const dir = fileURLToPath(new URL("../drizzle/", import.meta.url));
const read = (rel: string): string => readFileSync(`${dir}${rel}`, "utf8");
type Col = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string;
};
type Table = {
  name: string;
  columns: Record<string, Col>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  compositePrimaryKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
};
type Snap = { id: string; prevId: string; tables: Record<string, Table> };
const snap = (file: string): Snap =>
  JSON.parse(read(`meta/${file}`)) as Snap;
const W = "public.identity_workspace_workspaces";

describe("workspace locale removal migration (S1/T3)", () => {
  it("0006 contains exactly the locale DROP COLUMN statement", () => {
    const sql = read("0006_spooky_luminals.sql").trim();
    expect(sql).toBe(
      'ALTER TABLE "identity_workspace_workspaces" DROP COLUMN "locale";',
    );
    expect(sql).not.toMatch(/-->|CREATE|INSERT|UPDATE|DELETE|DROP TABLE|ADD COLUMN/);
  });

  it("journal registers 0006 as the head migration", () => {
    const { entries } = JSON.parse(read("meta/_journal.json")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    expect(entries.at(-1)).toMatchObject({ idx: 6, tag: "0006_spooky_luminals" });
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    expect(entries.at(-1)?.when).toBeGreaterThan(entries.at(-2)?.when ?? 0);
  });

  it("snapshot 0006 drops only locale from the workspace table", () => {
    const before = snap("0005_snapshot.json").tables[W];
    const after = snap("0006_snapshot.json").tables[W];
    if (!before || !after) throw new Error("workspace table missing");
    expect(before.columns.locale).toBeDefined();
    expect(after.columns.locale).toBeUndefined();
    const { locale: _dropped, ...kept } = before.columns;
    expect(after.columns).toEqual(kept);
    expect({ ...after, columns: null }).toEqual({ ...before, columns: null });
  });

  it("snapshot 0006 continues 0005 and changes no other table", () => {
    const before = snap("0005_snapshot.json");
    const after = snap("0006_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables));
    for (const name of Object.keys(before.tables)) {
      if (name !== W) expect(after.tables[name]).toEqual(before.tables[name]);
    }
  });

  it("schema.ts declares no locale and matches snapshot 0006", () => {
    const cols = getTableColumns(workspaces);
    const snapCols = snap("0006_snapshot.json").tables[W]?.columns;
    if (!snapCols) throw new Error("workspace table missing");
    expect(Object.keys(cols)).not.toContain("locale");
    expect(Object.keys(cols).sort()).toEqual(Object.keys(snapCols).sort());
    for (const [name, column] of Object.entries(cols)) {
      const expected = snapCols[name];
      if (!expected) throw new Error(`snapshot missing ${name}`);
      expect({
        name: column.name,
        notNull: column.notNull,
        primaryKey: column.primary,
      }).toEqual({
        name: expected.name,
        notNull: expected.notNull,
        primaryKey: expected.primaryKey,
      });
    }
  });
});
