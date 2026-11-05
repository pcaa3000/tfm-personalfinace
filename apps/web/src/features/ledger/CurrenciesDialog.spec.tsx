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
import { CurrenciesDialog } from "./CurrenciesDialog";
import type { CurrencyView, IsoCurrencyView } from "./types";

const currencies: CurrencyView[] = [
  {
    id: "cur-pen",
    workspaceId: "ws-1",
    code: "PEN",
    nameEn: "Peruvian Sol",
    nameEs: "Sol peruano",
    minorUnitExponent: 2,
    archivedAt: null,
  },
];

const catalog: IsoCurrencyView[] = [
  { code: "PEN", nameEn: "Peruvian Sol", nameEs: "Sol peruano", minorUnitExponent: 2 },
  { code: "USD", nameEn: "US Dollar", nameEs: "Dólar estadounidense", minorUnitExponent: 2 },
  { code: "ARS", nameEn: "Argentine Peso", nameEs: "Peso argentino", minorUnitExponent: 2 },
  { code: "JPY", nameEn: "Japanese Yen", nameEs: "Yen japonés", minorUnitExponent: 0 },
];

function renderDialog(
  overrides: Record<string, unknown> = {},
  props: { loadError?: string | null } = {},
) {
  const handlers = {
    onAdd: vi.fn(),
    onRevise: vi.fn(),
    onArchive: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <CurrenciesDialog
      open
      currencies={currencies}
      catalog={catalog}
      submitting={false}
      error={null}
      loadError={props.loadError ?? null}
      onClose={handlers.onClose}
      onAdd={handlers.onAdd}
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

describe("CurrenciesDialog (S12-4)", () => {
  it("lists the active workspace currencies", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Monedas" });
    expect(within(dialog).getByText(/PEN/)).toBeTruthy();
    expect(within(dialog).getByText(/Sol peruano/)).toBeTruthy();
  });

  it("searches the ISO catalog by code or basic name and adds a row", () => {
    const { onAdd } = renderDialog();

    fireEvent.change(
      screen.getByLabelText("Buscar por código o nombre"),
      { target: { value: "dolar" } },
    );

    expect(screen.getByText(/Dólar estadounidense/)).toBeTruthy();
    expect(screen.queryByText(/Peso argentino/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAdd).toHaveBeenCalledWith("USD");
  });

  it("matches catalog rows by basic currency names like 'peso' or 'sol'", () => {
    renderDialog();

    fireEvent.change(
      screen.getByLabelText("Buscar por código o nombre"),
      { target: { value: "peso" } },
    );
    expect(screen.getByText(/Peso argentino/)).toBeTruthy();
    expect(screen.queryByText(/Yen japonés/)).toBeNull();
  });

  it("revises the code of a currency", () => {
    const { onRevise } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Código"), {
      target: { value: "EUR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(onRevise).toHaveBeenCalledWith("cur-pen", { code: "EUR" });
  });

  it("archives a currency", () => {
    const { onArchive } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    expect(onArchive).toHaveBeenCalledWith("cur-pen");
  });

  it("surfaces catalog load failures instead of failing silently (T19)", () => {
    renderDialog(
      {},
      { loadError: "No se pudieron cargar las monedas." },
    );

    const dialog = screen.getByRole("dialog", { name: "Monedas" });
    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent).toContain(
      "No se pudieron cargar las monedas.",
    );
  });
});
