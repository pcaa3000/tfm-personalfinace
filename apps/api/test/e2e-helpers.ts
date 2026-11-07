import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { and, eq, inArray, isNull, like } from "drizzle-orm";

import { createDrizzleDb } from "../src/drizzle/db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactions,
  workspaces,
} from "../src/drizzle/schema.js";
import { buildApp, envFromProcess } from "../src/hono/composition.js";

/**
 * Shared helpers for HTTP e2e specs against the real Hono app + Docker
 * Postgres. Cleanup is scoped to workspaces whose identityKey contains
 * "|e2e-" (dev subjects "local|e2e-*" and OIDC subjects "…|e2e-*"), so
 * dev data is never touched.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

/** Drizzle handle for spec fixtures/cleanup (independent of the app's pool). */
export const { db, pool: testPool } = createDrizzleDb(DATABASE_URL);

export async function closeTestDb(): Promise<void> {
  await testPool.end();
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface TxView {
  id: string;
  workspaceId: string;
  type: string;
  amount: string;
  currency: string;
  concept: string;
  accountId: string | null;
  destinationAccountId: string | null;
  categoryId: string | null;
  status: string;
  revisionCount: number;
}

export interface AccountView {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  kind: string;
  initialBalance: string;
}

export interface RevisionView {
  kind: string;
  revisionNumber: number;
  actor: string;
  changes: Array<{ field: string; previous: string; next: string }>;
}

export interface CategoryView {
  id: string;
  key: string;
  label: string;
  nature: string;
  custom: boolean;
}

export interface CurrencyView {
  id: string;
  workspaceId: string;
  code: string;
  nameEn: string;
  nameEs: string;
  minorUnitExponent: number;
  archivedAt: string | null;
}

export interface IsoCurrencyView {
  code: string;
  nameEn: string;
  nameEs: string;
  minorUnitExponent: number;
}

let baseUrl = "";

export interface E2eApp {
  close: () => Promise<void>;
}

export async function bootApp(): Promise<E2eApp> {
  const built = buildApp(envFromProcess());
  const server = serve({ fetch: built.app.fetch, port: 0 });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await built.close();
    },
  };
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<ApiResponse<T>> {
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
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/**
 * Wipes workspaces, transactions and revisions created by e2e identities.
 * Each spec file owns a disjoint marker ("|e2e-dev-", "|e2e-oidc-") so
 * parallel vitest workers never delete each other's fixtures mid-test.
 */
export async function cleanE2eData(marker: string): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `%${marker}%`));
  const ids = owned.map((w) => w.id);
  if (ids.length > 0) {
    await db
      .delete(ledgerTransactions)
      .where(inArray(ledgerTransactions.workspaceId, ids));
    await db.delete(accounts).where(inArray(accounts.workspaceId, ids));
    await db.delete(currencies).where(inArray(currencies.workspaceId, ids));
    // T19: workspaces own provisioned seed-category copies too.
    await db.delete(categories).where(inArray(categories.workspaceId, ids));
    await db
      .delete(workspaces)
      .where(like(workspaces.identityKey, `%${marker}%`));
  }
}

export async function ensureGlobalCategory(): Promise<string> {
  const [existing] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.key, "e2e-food"), isNull(categories.workspaceId)))
    .limit(1);
  if (existing) {
    return existing.id;
  }
  const [created] = await db
    .insert(categories)
    .values({
      id: randomUUID(),
      key: "e2e-food",
      label: "E2E Food",
      nature: "essential",
      workspaceId: null,
    })
    .returning();
  if (!created) {
    throw new Error("failed to seed e2e global category");
  }
  return created.id;
}
