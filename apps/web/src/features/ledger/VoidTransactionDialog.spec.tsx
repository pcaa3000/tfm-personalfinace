// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { VoidTransactionDialog } from "./VoidTransactionDialog";
import type { TransactionView } from "./types";

const transaction: TransactionView = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "25.50",
  currency: "PEN",
  businessDate: "2026-10-01",
  timezone: "UTC",
  concept: "Supermercado",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-01T00:00:00.000Z",
  revisionCount: 0,
};

interface RenderOptions {
  transaction?: TransactionView | null;
  submitting?: boolean;
  error?: string | null;
}

function renderDialog(options: RenderOptions = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <VoidTransactionDialog
      transaction={
        options.transaction === undefined ? transaction : options.transaction
      }
      submitting={options.submitting ?? false}
      error={options.error ?? null}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  return { onClose, onConfirm };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("VoidTransactionDialog", () => {
  it("renders nothing when there is no transaction", () => {
    renderDialog({ transaction: null });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the void warning and the transaction summary", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Anular movimiento" });
    expect(
      within(dialog).getByText(/Anular marca el movimiento como cancelado/),
    ).toBeTruthy();
    const summary = within(dialog).getByText(/Supermercado/);
    expect(summary.textContent).toContain("25.50 PEN");
    expect(summary.textContent).toContain("1/10/2026");
  });

  it("confirm calls onConfirm with the transaction id", () => {
    const { onConfirm, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Anular" }));

    expect(onConfirm).toHaveBeenCalledWith("tx-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancel calls onClose without confirming", () => {
    const { onConfirm, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both actions and shows progress while submitting", () => {
    renderDialog({ submitting: true });

    const confirm = screen.getByRole("button", {
      name: "Anulando…",
    }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", {
      name: "Cancelar",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it("surfaces the error message", () => {
    renderDialog({ error: "No se pudo anular el movimiento." });

    const dialog = screen.getByRole("dialog", { name: "Anular movimiento" });
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "No se pudo anular el movimiento.",
    );
  });
});
