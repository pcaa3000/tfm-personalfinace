// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { EditTransactionDialog } from "./EditTransactionDialog";
import type {
  AccountView,
  CategoryView,
  TransactionView,
} from "./types";

const accounts: AccountView[] = [
  {
    id: "acc-pen",
    workspaceId: "ws-1",
    name: "BCP soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
  {
    id: "acc-usd",
    workspaceId: "ws-1",
    name: "Interbank dolares",
    currency: "USD",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

const categories: CategoryView[] = [
  {
    id: "cat-food",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: true,
  },
  {
    id: "cat-home",
    key: "home",
    label: "Hogar",
    nature: "essential",
    custom: true,
  },
];

const transaction: TransactionView = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "25.50",
  currency: "PEN",
  businessDate: "2026-10-01",
  timezone: "UTC",
  concept: "Supermercado",
  accountId: "acc-pen",
  destinationAccountId: null,
  categoryId: "cat-food",
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
  const onSubmit = vi.fn();
  render(
    <EditTransactionDialog
      transaction={
        options.transaction === undefined ? transaction : options.transaction
      }
      categories={categories}
      accounts={accounts}
      defaultCurrency="PEN"
      currencies={["PEN", "USD"]}
      submitting={options.submitting ?? false}
      error={options.error ?? null}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { onClose, onSubmit };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("EditTransactionDialog", () => {
  it("renders nothing when there is no transaction", () => {
    renderDialog({ transaction: null });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the form prefilled with the transaction values", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Editar movimiento" });
    expect(within(dialog).getByLabelText("Concepto")).toHaveProperty(
      "value",
      "Supermercado",
    );
    expect(within(dialog).getByLabelText("Importe")).toHaveProperty(
      "value",
      "25.50",
    );
    expect(within(dialog).getByLabelText("Fecha")).toHaveProperty(
      "value",
      "2026-10-01",
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Tipo" }).textContent,
    ).toBe("Gasto");
    expect(
      within(dialog).getByRole("combobox", { name: "Moneda" }).textContent,
    ).toBe("PEN");
    expect(
      within(dialog).getByRole("combobox", { name: "Cuenta" }).textContent,
    ).toContain("BCP soles");
    expect(
      within(dialog).getByRole("combobox", { name: "Categoría" }).textContent,
    ).toBe("Comida");
    expect(
      document.querySelector<HTMLInputElement>('input[name="accountId"]')
        ?.value,
    ).toBe("acc-pen");
  });

  it("keeps submit disabled until the form is dirty, then calls onSubmit with id and values", async () => {
    const { onSubmit } = renderDialog();

    const submit = screen.getByRole("button", {
      name: "Guardar cambios",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Concepto"), {
      target: { value: "Supermercado nuevo" },
    });

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        "tx-1",
        expect.objectContaining({
          type: "expense",
          amount: "25.50",
          currency: "PEN",
          businessDate: "2026-10-01",
          concept: "Supermercado nuevo",
          accountId: "acc-pen",
          destinationAccountId: null,
          categoryId: "cat-food",
        }),
      );
    });
  });

  it("does not call onSubmit while pristine", () => {
    const { onSubmit } = renderDialog();

    const submit = screen.getByRole("button", {
      name: "Guardar cambios",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces the error message", () => {
    renderDialog({ error: "No se pudo guardar el movimiento." });

    const dialog = screen.getByRole("dialog", { name: "Editar movimiento" });
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "No se pudo guardar el movimiento.",
    );
  });
});
