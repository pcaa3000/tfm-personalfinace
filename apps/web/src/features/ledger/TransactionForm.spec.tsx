// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { TransactionForm } from "./TransactionForm";
import type { AccountView } from "./types";

const accounts: AccountView[] = [
  { id: "acc-pen", workspaceId: "ws-1", name: "BCP soles", currency: "PEN", kind: "bank", initialBalance: "0.00", archivedAt: null },
  { id: "acc-cash", workspaceId: "ws-1", name: "Efectivo", currency: "PEN", kind: "cash", initialBalance: "0.00", archivedAt: null },
  { id: "acc-usd", workspaceId: "ws-1", name: "Interbank dolares", currency: "USD", kind: "bank", initialBalance: "0.00", archivedAt: null },
];

function renderForm(overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  render(
    <TransactionForm
      categories={[]}
      accounts={accounts}
      defaultCurrency="PEN"
      submitting={false}
      error={null}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionForm (accounts)", () => {
  it("renders an account selector", () => {
    renderForm();
    expect(screen.getByLabelText("Cuenta")).toBeTruthy();
  });

  it("defaults the currency to the workspace default", () => {
    render(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="USD"
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );
    const currency = screen.getByRole("combobox", { name: "Moneda" });
    expect(currency.textContent).toBe("USD");
  });

  it("syncs currency when defaultCurrency prop updates while form is pristine", async () => {
    const { rerender } = render(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="PEN"
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Moneda" }).textContent).toBe("PEN");

    rerender(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="USD"
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Moneda" }).textContent).toBe("USD");
    });
  });

  it("clears a selected account when the currency changes to another one", async () => {
    renderForm();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(screen.getByRole("option", { name: "BCP soles" }));
    expect(
      document.querySelector<HTMLInputElement>('input[name="accountId"]')?.value,
    ).toBe("acc-pen");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Moneda" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "USD" }),
    );

    await waitFor(() => {
      expect(
        document.querySelector<HTMLInputElement>('input[name="accountId"]')?.value,
      ).toBe("");
    });
  });

  it("shows localized validation error when submitting without an account", async () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "50.00" } });
    fireEvent.change(screen.getByLabelText("Concepto"), { target: { value: "Almuerzo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    await waitFor(() => {
      expect(screen.getByText("La cuenta es obligatoria")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TransactionForm (transfers, S12-3)", () => {
  it("pre-selects the movement type given by a quick action", () => {
    renderForm({ initialValues: { type: "income" } });

    expect(
      screen.getByRole("combobox", { name: "Tipo" }).textContent,
    ).toBe("Ingreso");
  });

  it("offers income, expense and transfer types", () => {
    renderForm();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));

    for (const label of ["Ingreso", "Gasto", "Transferencia"]) {
      expect(
        screen.getByRole("option", { name: label }),
        `missing type ${label}`,
      ).toBeTruthy();
    }
  });

  it("shows a destination account field and hides the category for transfers", async () => {
    renderForm();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Transferencia",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Cuenta destino" }),
      ).toBeTruthy();
    });
    expect(screen.queryByLabelText("Categoría")).toBeNull();
  });

  it("excludes the source account from the destination options", async () => {
    renderForm();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "BCP soles",
      }),
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Transferencia",
      }),
    );

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Cuenta destino" }),
    );
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox).getByRole("option", { name: "Efectivo" }),
    ).toBeTruthy();
    expect(
      within(listbox).queryByRole("option", { name: "BCP soles" }),
    ).toBeNull();
  });

  it("requires the destination account for a transfer", async () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("Importe"), {
      target: { value: "50.00" },
    });
    fireEvent.change(screen.getByLabelText("Concepto"), {
      target: { value: "Retiro" },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "BCP soles",
      }),
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Transferencia",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    await waitFor(() => {
      expect(
        screen.getByText("La cuenta destino es obligatoria"),
      ).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a transfer with destinationAccountId and no category", async () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("Importe"), {
      target: { value: "300.00" },
    });
    fireEvent.change(screen.getByLabelText("Concepto"), {
      target: { value: "Retiro a efectivo" },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "BCP soles",
      }),
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Transferencia",
      }),
    );
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Cuenta destino" }),
    );
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Efectivo",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transfer",
          accountId: "acc-pen",
          destinationAccountId: "acc-cash",
          categoryId: null,
        }),
      );
    });
  });
});
