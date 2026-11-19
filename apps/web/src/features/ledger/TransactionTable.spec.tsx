// @vitest-environment jsdom
import { ThemeProvider } from "@mui/material/styles";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { buildAppTheme } from "../../theme";
import { TransactionTable } from "./TransactionTable";
import type { LedgerRow } from "./types";

const baseRow: LedgerRow = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "12.50",
  currency: "USD",
  businessDate: "2026-10-01",
  timezone: "UTC",
  concept: "almuerzo",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-01T12:00:00Z",
  revisionCount: 0,
  splits: [],
};

const accounts = [
  {
    id: "acc-1",
    workspaceId: "ws-1",
    name: "BCP soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
  {
    id: "acc-2",
    workspaceId: "ws-1",
    name: "Efectivo",
    currency: "PEN",
    kind: "cash",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

/**
 * Raw CSS of every injected rule that targets one of the element's
 * classes (emotion <style> tags — jsdom cannot compute styles from
 * stylesheets, so sx assertions go through the serialized CSS).
 */
function cssTextOf(el: Element): string {
  const classes = [...el.classList];
  let out = "";
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent ?? "";
    if (classes.some((c) => text.includes(`.${c}`))) out += text;
    const sheet = style.sheet;
    if (sheet) {
      for (const rule of Array.from(sheet.cssRules ?? [])) {
        if (classes.some((c) => rule.cssText.includes(`.${c}`))) {
          out += rule.cssText;
        }
      }
    }
  }
  return out.replace(/\s+/g, "");
}

function renderTable(
  props: Partial<Parameters<typeof TransactionTable>[0]> = {},
) {
  return render(
    <ThemeProvider theme={buildAppTheme("light")}>
      <TransactionTable
        transactions={[baseRow]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionTable (es)", () => {
  it("renders spanish headers, status and uncategorized label", () => {
    renderTable();
    expect(screen.getByText("Concepto")).toBeTruthy();
    expect(screen.getByText("Cuenta")).toBeTruthy();
    expect(screen.getByText("BCP soles")).toBeTruthy();
    expect(screen.getByText("Sin categorizar")).toBeTruthy();
    expect(screen.getByText("confirmada")).toBeTruthy();
    expect(screen.getByText("Gasto")).toBeTruthy();
    expect(screen.getByText("Editar")).toBeTruthy();
    expect(screen.getByText("Anular")).toBeTruthy();
  });

  it("shows the pending sync chip and disables row actions", () => {
    renderTable({
      transactions: [{ ...baseRow, id: "pending:x", pendingSync: true }],
    });
    expect(screen.getByText("Pendiente de sincronización")).toBeTruthy();
    expect(screen.getByText("Editar")).toHaveProperty("disabled", true);
    expect(screen.getByText("Anular")).toHaveProperty("disabled", true);
  });

  it("renders a transfer with the origin → destination account pair (S12-3)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          id: "tx-transfer",
          type: "transfer",
          concept: "Retiro a efectivo",
          currency: "PEN",
          destinationAccountId: "acc-2",
        },
      ],
    });
    expect(screen.getByText("Transferencia")).toBeTruthy();
    expect(screen.getByText(/BCP soles\s*→\s*Efectivo/)).toBeTruthy();
  });

  it("scrolls horizontally with a 720px min-width instead of compressing columns (S8)", () => {
    renderTable();

    const table = screen.getByRole("table");
    const scroller = table.parentElement;
    expect(scroller).toBeTruthy();
    expect(cssTextOf(scroller!)).toContain("overflow-x:auto");
    expect(cssTextOf(table)).toContain("min-width:720px");
  });

  it("keeps the sticky header offset under the sticky block (S8)", () => {
    const { container } = renderTable();

    const headerRow = container.querySelector("thead tr");
    expect(headerRow).toBeTruthy();
    expect(cssTextOf(headerRow!)).toContain("position:sticky");
  });

  it("renders transfers with the transfer palette token on chip and amount (S9)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          id: "tx-transfer",
          type: "transfer",
          amount: "300.00",
          currency: "PEN",
          concept: "Retiro a efectivo",
          destinationAccountId: "acc-2",
        },
      ],
    });

    const chip = screen.getByText("Transferencia").closest(".MuiChip-root");
    expect(chip?.className).toContain("MuiChip-colorTransfer");
    const amountCell = screen.getByText("300.00 PEN");
    expect(cssTextOf(amountCell)).toContain("color:#7c6bad");
  });

  it("empty state offers a CTA that invokes onNewMovement (S1)", () => {
    const onNewMovement = vi.fn();
    renderTable({ transactions: [], onNewMovement });
    expect(screen.getByText("Todavía no hay movimientos.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrá tu primer movimiento" }),
    );
    expect(onNewMovement).toHaveBeenCalledTimes(1);
  });

  it("shows 'Sin cuenta' for a transaction without account", () => {
    renderTable({ transactions: [{ ...baseRow, accountId: null }] });
    expect(screen.getByText("Sin cuenta")).toBeTruthy();
  });

  it("shows the split count when a transaction is divided (receipt-scan-drafts T7)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          splits: [
            { categoryId: "cat-food", amount: "8.50" },
            { categoryId: "cat-home", amount: "4.00" },
          ],
        },
      ],
    });
    expect(screen.getByText("Dividido (2)")).toBeTruthy();
    expect(screen.queryByText("Sin categorizar")).toBeNull();
  });
});
