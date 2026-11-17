// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("BalanceStrip (S12-5, S12-7 financial design system)", () => {
  it("renders one brand card per currency with saldo actual, ingresos and gastos", () => {
    const { container, getByLabelText } = renderStrip();
    // Amounts are hidden by default (S2); reveal both cards.
    fireEvent.click(getByLabelText("Mostrar montos de PEN"));
    fireEvent.click(getByLabelText("Mostrar montos de USD"));

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
    const { container, getByLabelText } = renderStrip();
    fireEvent.click(getByLabelText("Mostrar montos de PEN"));

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

  it("offers prev/next buttons and dots as real buttons (mouse affordance, T23)", () => {
    const { container, getByLabelText } = renderStrip();

    expect(getByLabelText("Moneda anterior")).toBeTruthy();
    expect(getByLabelText("Moneda siguiente")).toBeTruthy();
    const dots = container.querySelectorAll("[data-part='carousel-dot']");
    expect(dots[0]?.tagName).toBe("BUTTON");
  });

  it("clicking next scrolls the card track by one card", () => {
    const { container, getByLabelText } = renderStrip();
    const scroller = container.querySelector("[role='group']") as HTMLElement;
    const firstCard = scroller.querySelector("[data-currency]");
    Object.defineProperty(firstCard, "offsetWidth", {
      value: 200,
      configurable: true,
    });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.click(getByLabelText("Moneda siguiente"));

    expect(scrollBy).toHaveBeenCalledWith({ left: 224, behavior: "smooth" });
  });

  it("clicking a dot scrolls directly to that card", () => {
    const { container } = renderStrip();
    const scroller = container.querySelector("[role='group']") as HTMLElement;
    const firstCard = scroller.querySelector("[data-currency]");
    Object.defineProperty(firstCard, "offsetWidth", {
      value: 200,
      configurable: true,
    });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;

    const dots = container.querySelectorAll("[data-part='carousel-dot']");
    fireEvent.click(dots[1]!);

    expect(scrollTo).toHaveBeenCalledWith({ left: 224, behavior: "smooth" });
  });

  it("the active dot follows the scroll position", () => {
    const { container } = renderStrip();
    const scroller = container.querySelector("[role='group']") as HTMLElement;
    const firstCard = scroller.querySelector("[data-currency]");
    Object.defineProperty(firstCard, "offsetWidth", {
      value: 200,
      configurable: true,
    });

    const dots = container.querySelectorAll("[data-part='carousel-dot']");
    expect(dots[0]?.getAttribute("data-active")).toBe("true");

    Object.defineProperty(scroller, "scrollLeft", {
      value: 224,
      configurable: true,
    });
    fireEvent.scroll(scroller);

    expect(dots[1]?.getAttribute("data-active")).toBe("true");
    expect(dots[0]?.getAttribute("data-active")).toBe("false");
  });
});

describe("privacy eye per currency card (hide-balance-amounts S1-S4)", () => {
  it("masks amounts by default and exposes an aria-pressed eye button (S1, S2, S4)", () => {
    const { container, getByLabelText } = renderStrip();

    const pen = container.querySelector('[data-currency="PEN"]');
    expect(pen?.textContent).toContain("•••");
    expect(pen?.textContent).not.toContain("9,134.25");
    expect(pen?.textContent).not.toContain("4,500.00");
    expect(pen?.textContent).not.toContain("565.75");
    const usd = container.querySelector('[data-currency="USD"]');
    expect(usd?.textContent).not.toContain("1,984.02");

    const eye = getByLabelText("Mostrar montos de PEN");
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    // Revealing a card also exposes its "ocultar" affordance.
    expect(getByLabelText("Mostrar montos de USD")).toBeTruthy();
  });

  it("clicking a card's eye reveals its amounts and flips aria-pressed; clicking again re-hides (S1, S4)", () => {
    const { container, getByLabelText, queryByLabelText } = renderStrip();
    const pen = container.querySelector('[data-currency="PEN"]');
    const usd = container.querySelector('[data-currency="USD"]');

    fireEvent.click(getByLabelText("Mostrar montos de PEN"));

    expect(pen?.textContent).toContain("9,134.25");
    expect(pen?.textContent).toContain("4,500.00");
    expect(pen?.textContent).toContain("565.75");
    const eye = getByLabelText("Ocultar montos de PEN");
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    // Toggling one card does not touch the other.
    expect(usd?.textContent).not.toContain("1,984.02");

    fireEvent.click(eye);

    expect(pen?.textContent).not.toContain("9,134.25");
    expect(pen?.textContent).toContain("•••");
    expect(queryByLabelText("Mostrar montos de PEN")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("restores persisted per-currency flags from localStorage (S3)", () => {
    localStorage.setItem(
      "tfm-hide-amounts-cards",
      JSON.stringify({ PEN: false }),
    );

    const { container } = renderStrip();

    const pen = container.querySelector('[data-currency="PEN"]');
    const usd = container.querySelector('[data-currency="USD"]');
    expect(pen?.textContent).toContain("9,134.25");
    expect(usd?.textContent).not.toContain("1,984.02");
    expect(usd?.textContent).toContain("•••");
  });

  it("writes toggles back to localStorage keyed by currency (S3)", () => {
    const { getByLabelText } = renderStrip();

    fireEvent.click(getByLabelText("Mostrar montos de USD"));

    const saved = JSON.parse(
      localStorage.getItem("tfm-hide-amounts-cards") ?? "{}",
    ) as Record<string, boolean>;
    expect(saved.USD).toBe(false);
  });

  it("tolerates corrupt persisted values and stays hidden (S2, S3)", () => {
    localStorage.setItem("tfm-hide-amounts-cards", "{not json");

    const { container } = renderStrip();

    const pen = container.querySelector('[data-currency="PEN"]');
    expect(pen?.textContent).not.toContain("9,134.25");
    expect(pen?.textContent).toContain("•••");
  });
});
