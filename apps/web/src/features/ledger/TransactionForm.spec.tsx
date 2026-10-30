// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});
