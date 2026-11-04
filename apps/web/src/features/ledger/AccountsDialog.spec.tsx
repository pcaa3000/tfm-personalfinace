// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { AccountsDialog } from "./AccountsDialog";
import type { AccountView } from "./types";

const accounts: AccountView[] = [
  {
    id: "acc-1",
    workspaceId: "ws-1",
    name: "BCP Soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "1500.00",
    archivedAt: null,
  },
  {
    id: "acc-2",
    workspaceId: "ws-1",
    name: "Efectivo",
    currency: "USD",
    kind: "cash",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

function renderDialog(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onRevise: vi.fn(),
    onArchive: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <AccountsDialog
      open
      accounts={accounts}
      currencies={["PEN", "USD"]}
      submitting={false}
      error={null}
      onClose={handlers.onClose}
      onCreate={handlers.onCreate}
      onRevise={handlers.onRevise}
      onArchive={handlers.onArchive}
    />,
  );
  return handlers;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("AccountsDialog (S12-1, S12-2)", () => {
  it("lists accounts with kind and initial balance", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Cuentas" });
    expect(within(dialog).getByText("BCP Soles")).toBeTruthy();
    expect(
      within(dialog).getAllByText(/Bancaria/).length,
    ).toBeGreaterThan(0);
    // the decimals are dimmed in a nested span — match on textContent
    expect(
      within(dialog).getAllByText((_content, element) =>
        Boolean(element?.textContent?.includes("1,500.00")),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("creates an account with kind and initialBalance", () => {
    const { onCreate } = renderDialog();

    fireEvent.change(screen.getByLabelText("Nombre de la cuenta"), {
      target: { value: "Ahorros Interbank" },
    });
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Tipo de cuenta" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Ahorro" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Moneda" }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "USD",
      }),
    );
    fireEvent.change(screen.getByLabelText("Saldo inicial"), {
      target: { value: "250.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "Ahorros Interbank",
      currency: "USD",
      kind: "savings",
      initialBalance: "250.75",
    });
  });

  it("offers the eight account kinds (S12-2)", () => {
    renderDialog();

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Tipo de cuenta" }),
    );

    for (const label of [
      "Efectivo",
      "Bancaria",
      "Ahorro",
      "Tarjeta de crédito",
      "Virtual",
      "Inversión",
      "Préstamo",
      "Seguro",
    ]) {
      expect(
        screen.getByRole("option", { name: label }),
        `missing kind ${label}`,
      ).toBeTruthy();
    }
  });

  it("revises an account name, kind and initialBalance", () => {
    const { onRevise } = renderDialog();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Editar" })[0]!,
    );
    fireEvent.change(screen.getByLabelText("Nombre de la cuenta"), {
      target: { value: "BCP Principal" },
    });
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Tipo de cuenta" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Inversión" }));
    fireEvent.change(screen.getByLabelText("Saldo inicial"), {
      target: { value: "2000.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(onRevise).toHaveBeenCalledWith("acc-1", {
      name: "BCP Principal",
      kind: "investment",
      initialBalance: "2000.00",
    });
  });

  it("archives an account", () => {
    const { onArchive } = renderDialog();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Archivar" })[0]!,
    );

    expect(onArchive).toHaveBeenCalledWith("acc-1");
  });
});
