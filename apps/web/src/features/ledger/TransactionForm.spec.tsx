// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { TransactionForm } from "./TransactionForm";

const accounts = [
  { id: "acc-pen", workspaceId: "ws-1", name: "BCP soles", currency: "PEN", kind: "bank" },
  { id: "acc-usd", workspaceId: "ws-1", name: "Interbank dolares", currency: "USD", kind: "bank" },
];

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionForm (accounts)", () => {
  it("renders an account selector", () => {
    render(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="PEN"
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );
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
    render(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="PEN"
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(screen.getByRole("option", { name: "BCP soles" }));
    expect(
      document.querySelector<HTMLInputElement>('input[name="accountId"]')?.value,
    ).toBe("acc-pen");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Moneda" }));
    fireEvent.click(screen.getByRole("option", { name: "USD" }));

    await waitFor(() => {
      expect(
        document.querySelector<HTMLInputElement>('input[name="accountId"]')?.value,
      ).toBe("");
    });
  });

  it("shows localized validation error when submitting without an account", async () => {
    const onSubmit = vi.fn();
    render(
      <TransactionForm
        categories={[]}
        accounts={accounts}
        defaultCurrency="PEN"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "50.00" } });
    fireEvent.change(screen.getByLabelText("Concepto"), { target: { value: "Almuerzo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    await waitFor(() => {
      expect(screen.getByText("La cuenta es obligatoria")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
