// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { ApiError } from "./api";
import { TransactionForm } from "./TransactionForm";
import type { AccountView, CategoryView } from "./types";

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

function submitValidExpense(onSubmit: ReturnType<typeof vi.fn>) {
  void onSubmit;
  fireEvent.change(screen.getByLabelText("Importe"), {
    target: { value: "50.00" },
  });
  fireEvent.change(screen.getByLabelText("Concepto"), {
    target: { value: "Almuerzo" },
  });
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
  fireEvent.click(
    within(screen.getByRole("listbox")).getByRole("option", {
      name: "BCP soles",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));
}

const formCategories: CategoryView[] = [
  {
    id: "cat-food",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: false,
  },
  {
    id: "cat-rest",
    key: "restaurants",
    label: "Restaurantes y cafés",
    nature: "discretionary",
    custom: false,
  },
];

function categoryIdInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[name="categoryId"]',
  );
  if (!input) throw new Error("categoryId input not rendered");
  return input;
}

function openInlineCategoryForm() {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Categoría" }));
  fireEvent.click(screen.getByRole("option", { name: /Nueva categoría/i }));
}

async function fillInlineCategoryForm(label: string) {
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    within(dialog).getByLabelText("Nombre de la categoría"),
    { target: { value: label } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Crear categoría" }),
  );
}

describe("TransactionForm — inline category creation (T8, S8)", () => {
  it("creates a category from the select and auto-selects it", async () => {
    const onCreateCategory = vi.fn().mockResolvedValue({
      id: "cat-pets",
      key: "mascotas",
      label: "Mascotas",
      nature: "discretionary",
      custom: true,
    });
    renderForm({ categories: formCategories, onCreateCategory });

    openInlineCategoryForm();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText("Nombre de la categoría"),
      { target: { value: "Mascotas" } },
    );
    fireEvent.mouseDown(
      within(dialog).getByRole("combobox", { name: "Naturaleza" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "Discrecional" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Crear categoría" }),
    );

    await waitFor(() => {
      expect(onCreateCategory).toHaveBeenCalledWith({
        label: "Mascotas",
        nature: "discretionary",
      });
    });
    // The new category fills the field without leaving the form (S8).
    await waitFor(() => {
      expect(categoryIdInput().value).toBe("cat-pets");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("selects the existing category when the API reports CATEGORY_KEY_TAKEN", async () => {
    // "Mascotas" derives the key "mascotas", already held by cat-pets.
    const catalog = [
      ...formCategories,
      {
        id: "cat-pets",
        key: "mascotas",
        label: "Mascotas",
        nature: "discretionary",
        custom: true,
      },
    ];
    const onCreateCategory = vi
      .fn()
      .mockRejectedValue(
        new ApiError("CATEGORY_KEY_TAKEN", "taken", 409),
      );
    renderForm({ categories: catalog, onCreateCategory });

    openInlineCategoryForm();
    await fillInlineCategoryForm("Mascotas");

    // Create-or-reuse: the colliding category fills the field and the
    // dialog closes instead of surfacing an error.
    await waitFor(() => {
      expect(categoryIdInput().value).toBe("cat-pets");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("keeps the dialog open with a localized error on other failures", async () => {
    const onCreateCategory = vi
      .fn()
      .mockRejectedValue(new ApiError("GENERIC", "boom", 500));
    renderForm({ categories: formCategories, onCreateCategory });

    openInlineCategoryForm();
    await fillInlineCategoryForm("Mascotas");

    expect(
      await screen.findByText(
        "No se pudo completar la operación. Intentá de nuevo.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("TransactionForm — concept category suggestion (T8, D1b)", () => {
  it("offers a suggestion chip that fills the select only on click", async () => {
    renderForm({ categories: formCategories });

    fireEvent.change(screen.getByLabelText("Concepto"), {
      target: { value: "Cena en restaurante" },
    });

    const chip = await screen.findByRole("button", {
      name: "¿Categoría: Restaurantes y cafés?",
    });
    // Never auto-set silently: the field stays empty until the click.
    expect(categoryIdInput().value).toBe("");

    fireEvent.click(chip);
    expect(categoryIdInput().value).toBe("cat-rest");
  });

  it("does not suggest once the user picked a category", async () => {
    renderForm({ categories: formCategories });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Categoría" }));
    fireEvent.click(screen.getByRole("option", { name: "Comida" }));
    fireEvent.change(screen.getByLabelText("Concepto"), {
      target: { value: "Cena en restaurante" },
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /¿Categoría:/ }),
      ).toBeNull();
    });
  });
});

describe("TransactionForm (workspace timezone, S1-S2)", () => {
  it("submits the workspace timezone received by prop", async () => {
    const { onSubmit } = renderForm({ timezone: "America/Lima" });

    submitValidExpense(onSubmit);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: "America/Lima" }),
      );
    });
  });

  it("defaults businessDate to today in the effective zone", () => {
    vi.useFakeTimers();
    try {
      // 2026-10-01T04:00:00Z is still 2026-09-30 in America/Lima (UTC-5).
      vi.setSystemTime(new Date("2026-10-01T04:00:00Z"));
      renderForm({ timezone: "America/Lima" });
      const input = document.querySelector<HTMLInputElement>(
        'input[name="businessDate"]',
      );
      expect(input?.value).toBe("2026-09-30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the browser timezone when no prop is given", async () => {
    const { onSubmit } = renderForm();

    submitValidExpense(onSubmit);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      );
    });
  });
});
