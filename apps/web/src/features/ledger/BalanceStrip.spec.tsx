// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import i18n from "../../i18n";
import { BalanceStrip } from "./BalanceStrip";
import type { CurrencySummary } from "./summarize";
import type { AccountView } from "./types";

const summaries: CurrencySummary[] = [
  {
    currency: "PEN",
    incomeMinor: 450000n,
    expenseMinor: 56575n,
    netMinor: 393425n,
    initialBalanceMinor: 520000n,
    balanceMinor: 913425n,
  },
  {
    currency: "USD",
    incomeMinor: 85000n,
    expenseMinor: 6598n,
    netMinor: 78402n,
    initialBalanceMinor: 120000n,
    balanceMinor: 198402n,
  },
];

const accounts: AccountView[] = [
  {
    id: "a1",
    workspaceId: "ws",
    name: "BCP Soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "5000.00",
    archivedAt: null,
  },
  {
    id: "a2",
    workspaceId: "ws",
    name: "Efectivo",
    currency: "PEN",
    kind: "cash",
    initialBalance: "200.00",
    archivedAt: null,
  },
  {
    id: "a3",
    workspaceId: "ws",
    name: "Interbank Dólares",
    currency: "USD",
    kind: "bank",
    initialBalance: "1200.00",
    archivedAt: null,
  },
];

function renderStrip() {
  return render(
    <BalanceStrip
      summaries={summaries}
      accounts={accounts}
      defaultCurrency="PEN"
    />,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("BalanceStrip (S12-5, S12-7 financial design system)", () => {
  it("renders one brand card per currency with saldo actual, ingresos and gastos", () => {
    const { container } = renderStrip();

    const pen = container.querySelector('[data-currency="PEN"]');
    expect(pen).toBeTruthy();
    expect(pen?.textContent).toContain("Saldo actual");
    // 5000.00 + 200.00 + 4500.00 − 565.75 = 9134.25
    expect(pen?.textContent).toContain("9,134.25");
    expect(pen?.textContent).toContain("4,500.00");
    expect(pen?.textContent).toContain("565.75");
    expect(pen?.textContent).toContain("BCP Soles");
    expect(pen?.textContent).toContain("Efectivo");

    const usd = container.querySelector('[data-currency="USD"]');
    expect(usd?.textContent).toContain("1,984.02");
  });

  it("tints the default currency card with the primary variant and accents others", () => {
    const { container } = renderStrip();

    expect(
      container.querySelector('[data-currency="PEN"]')?.getAttribute("data-variant"),
    ).toBe("primary");
    expect(
      container.querySelector('[data-currency="USD"]')?.getAttribute("data-variant"),
    ).toBe("accent");
  });

  it("dims the decimal part of the amounts", () => {
    const { container } = renderStrip();

    const decimals = container.querySelectorAll("[data-part='decimals']");
    expect(decimals.length).toBeGreaterThan(0);
    expect(decimals[0]?.textContent).toMatch(/^\.\d{2}$/);
  });

  it("renders one carousel dot per currency card", () => {
    const { container } = renderStrip();

    expect(
      container.querySelectorAll("[data-part='carousel-dot']"),
    ).toHaveLength(2);
  });
});
