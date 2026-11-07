import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { categories, currencies, workspaces } from "./schema.js";
import { createDrizzleDb } from "./db.js";

// Spanish-first product: labels match docs/06 (Hogar, Comida, Sueldo…).
// Keys stay stable English identifiers; the web translates them per locale.
const GLOBAL_CATEGORIES = [
  { key: "salary", label: "Sueldo", nature: "income" },
  { key: "other_income", label: "Otros ingresos", nature: "income" },
  { key: "home", label: "Hogar", nature: "essential" },
  { key: "food", label: "Comida", nature: "essential" },
  { key: "transport", label: "Transporte", nature: "essential" },
  { key: "health", label: "Salud", nature: "essential" },
  { key: "services", label: "Servicios y suscripciones", nature: "essential" },
  { key: "education", label: "Educación", nature: "essential" },
  { key: "leisure", label: "Ocio", nature: "discretionary" },
  { key: "restaurants", label: "Restaurantes y cafés", nature: "discretionary" },
  { key: "shopping", label: "Compras", nature: "discretionary" },
  { key: "taxes", label: "Impuestos y obligaciones", nature: "obligation" },
] as const;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

async function main(): Promise<void> {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.identityKey, "local|dev-user"))
    .limit(1);
  const workspace =
    existing ??
    (
      await db
        .insert(workspaces)
        .values({
          id: "ws-local-dev",
          identityKey: "local|dev-user",
          kind: "personal",
          locale: "en-US",
          timezone: "UTC",
          defaultCurrency: "PEN",
        })
        .returning()
    )[0];

  if (!workspace) {
    throw new Error("workspace insert returned no row");
  }

  // Workspace currency catalog bootstrap (T18): each workspace starts
  // with at least its defaultCurrency so INV-MON-03 holds for existing
  // accounts. Additional codes are added through POST /api/v1/currencies.
  await db
    .insert(currencies)
    .values({
      id: randomUUID(),
      workspaceId: workspace.id,
      code: workspace.defaultCurrency,
    })
    .onConflictDoNothing();

  for (const category of GLOBAL_CATEGORIES) {
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.key, category.key), isNull(categories.workspaceId)))
      .limit(1);
    if (existing) {
      await db
        .update(categories)
        .set({ label: category.label, nature: category.nature })
        .where(eq(categories.id, existing.id));
    } else {
      await db
        .insert(categories)
        .values({ id: randomUUID(), ...category, workspaceId: null });
    }
  }

  // Workspace seed categories bootstrap (T19): the dev workspace owns
  // editable copies of the catalog (the global rows stay read-only
  // fallbacks). Same pattern as the currency upsert above — only the
  // `uncategorized` system fallback is never copied.
  for (const category of GLOBAL_CATEGORIES) {
    await db
      .insert(categories)
      .values({ id: randomUUID(), ...category, workspaceId: workspace.id })
      .onConflictDoNothing();
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
