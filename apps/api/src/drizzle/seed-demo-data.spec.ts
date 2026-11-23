import { describe, expect, it } from "vitest";

import {
  buildDemoPlan,
  demoWindowMonths,
  demoWindowStart,
} from "./seed-demo-data.js";

/**
 * reports-monthly T11 (S10): the demo seed must materialize detectable
 * avoidable-expense groups — discretionary categories (minor transport,
 * subscriptions) plus shared explicit merchants — so the avoidable-expenses
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
    // Ant-expense policy: group mean must stay <= 1% of the period's
    // confirmed income — compare against the plan's actual seeded income.
    const incomeMinor = plan.transactions
      .filter((transaction) => transaction.type === "income")
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
    const mean =
      fares.reduce((sum, transaction) => sum + transaction.amountMinor, 0) /
      fares.length;
    expect(mean).toBeLessThanOrEqual(incomeMinor / 100);
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

describe("buildDemoPlan six-month window (demo-seed-six-months T1, S1/S2)", () => {
  const plan = buildDemoPlan(NOW);

  it("rolls the maintenance window across six calendar months: current plus five back (S1)", () => {
    expect(demoWindowMonths(NOW).map((month) => month.key)).toEqual([
      "2026-03",
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
      "2025-10",
    ]);
    expect(demoWindowStart(NOW)).toBe("2025-10-01");
  });

  it("keeps every transaction inside the 180-day window and reaches the oldest month (S1)", () => {
    for (const transaction of plan.transactions) {
      expect(
        transaction.businessDate >= "2025-09-17" &&
          transaction.businessDate <= "2026-03-15",
      ).toBe(true);
    }
    expect(
      plan.transactions.some((transaction) =>
        transaction.businessDate.startsWith("2025-10"),
      ),
    ).toBe(true);
  });

  it("keeps per-month density in every window month (S2)", () => {
    for (const { key } of demoWindowMonths(NOW)) {
      const monthRows = plan.transactions.filter((transaction) =>
        transaction.businessDate.startsWith(key),
      );
      // Fixed bills + salary alone put several rows in each month.
      expect(monthRows.length).toBeGreaterThanOrEqual(5);
      // Freelance income is generated per month.
      expect(
        monthRows.some(
          (transaction) => transaction.categoryKey === "other_income",
        ),
      ).toBe(true);
      // The restaurants variable group is generated per month.
      expect(
        monthRows.filter(
          (transaction) => transaction.categoryKey === "restaurants",
        ).length,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("roughly doubles the absolute volume of the former 90-day plan (S2)", () => {
    // The 3-month plan produced ~167 rows for this NOW.
    expect(plan.transactions.length).toBeGreaterThanOrEqual(300);
  });

  it("keeps idempotency keys unique and padded past three digits (S5)", () => {
    const keys = plan.transactions.map(
      (transaction) => transaction.idempotencyKey,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("demo-maria-0001");
    expect(keys.every((key) => /^demo-maria-\d{4,}$/.test(key))).toBe(true);
  });
});
