// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
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

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionTable (es)", () => {
  it("renders spanish headers, status and uncategorized label", () => {
    render(
      <TransactionTable
        transactions={[baseRow]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
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
    render(
      <TransactionTable
        transactions={[{ ...baseRow, id: "pending:x", pendingSync: true }]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("Pendiente de sincronización")).toBeTruthy();
    expect(screen.getByText("Editar")).toHaveProperty("disabled", true);
    expect(screen.getByText("Anular")).toHaveProperty("disabled", true);
  });

  it("renders a transfer with the origin → destination account pair (S12-3)", () => {
    render(
      <TransactionTable
        transactions={[
          {
            ...baseRow,
            id: "tx-transfer",
            type: "transfer",
            concept: "Retiro a efectivo",
            currency: "PEN",
            destinationAccountId: "acc-2",
          },
        ]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("Transferencia")).toBeTruthy();
    expect(screen.getByText(/BCP soles\s*→\s*Efectivo/)).toBeTruthy();
  });

  it("shows 'Sin cuenta' for a transaction without account", () => {
    render(
      <TransactionTable
        transactions={[{ ...baseRow, accountId: null }]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("Sin cuenta")).toBeTruthy();
  });
});
