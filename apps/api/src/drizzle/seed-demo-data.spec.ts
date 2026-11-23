import { describe, expect, it } from "vitest";

import { buildDemoPlan } from "./seed-demo-data.js";

/**
 * reports-monthly T11 (S10): the demo seed must materialize detectable
 * ant-expense groups — discretionary categories (minor transport,
 * subscriptions) plus shared explicit merchants — so the ant-expenses
 * report never renders empty on the demo workspace.
 *
 * Pure unit check on the generated plan; no database required.
 */

// Midday UTC keeps the America/Lima "today" identical to the UTC date.
const NOW = new Date("2026-03-15T12:00:00Z");

describe("buildDemoPlan ant-expense materialization (reports-monthly T11, S10)", () => {
  const plan = buildDemoPlan(NOW);

  it("seeds the near-daily minor transport fares under a discretionary category with one shared merchant", () => {
    const fares = plan.transactions.filter(
      (transaction) => transaction.categoryKey === "minor_transport",
    );
    // The ant-expense policy needs >=3 operations in the window.
    expect(fares.length).toBeGreaterThanOrEqual(3);
    expect(
      fares.every((transaction) => transaction.merchant === "combi"),
    ).toBe(true);
    // Mean stays well under the 1%-of-income threshold (S/ 5–20 fares).
    const mean =
      fares.reduce((sum, transaction) => sum + transaction.amountMinor, 0) /
      fares.length;
    expect(mean).toBeLessThanOrEqual(2_000);
  });

  it("moves streaming subscriptions out of the essential services category", () => {
    const subscriptionConcepts = new Set(
      plan.transactions
        .filter((transaction) => transaction.categoryKey === "subscriptions")
        .map((transaction) => transaction.concept),
    );
    expect(subscriptionConcepts).toEqual(new Set(["Netflix", "Spotify"]));

    const serviceConcepts = new Set(
      plan.transactions
        .filter((transaction) => transaction.categoryKey === "services")
        .map((transaction) => transaction.concept),
    );
    expect(serviceConcepts.has("Netflix")).toBe(false);
    expect(serviceConcepts.has("Spotify")).toBe(false);
    // Fixed utility bills stay on `services` (essential).
    expect(serviceConcepts.has("Internet hogar")).toBe(true);
    expect(serviceConcepts.has("Plan celular")).toBe(true);
    expect(serviceConcepts.has("Luz y agua")).toBe(true);
  });

  it("seeds a second recurring café group sharing one explicit merchant", () => {
    const cafes = plan.transactions.filter(
      (transaction) => transaction.merchant === "cafe",
    );
    expect(cafes.length).toBeGreaterThanOrEqual(3);
    expect(
      cafes.every((transaction) => transaction.categoryKey === "restaurants"),
    ).toBe(true);
  });
});
