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
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-01T12:00:00Z",
  revisionCount: 0,
};

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
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("Concepto")).toBeTruthy();
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
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("Pendiente de sincronización")).toBeTruthy();
    expect(screen.getByText("Editar")).toHaveProperty("disabled", true);
    expect(screen.getByText("Anular")).toHaveProperty("disabled", true);
  });
});
