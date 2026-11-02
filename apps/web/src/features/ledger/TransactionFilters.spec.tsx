// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { TransactionFilters } from "./TransactionFilters";

const categories = [
  {
    id: "cat-food",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: false,
  },
];

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionFilters", () => {
  it("emits the search text as q filter (RF-013)", () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters categories={categories} value={{}} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Buscar concepto"), {
      target: { value: "lunch" },
    });

    expect(onChange).toHaveBeenLastCalledWith({ q: "lunch" });
  });

  it("emits type and category selections as filters (RF-013)", async () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters categories={categories} value={{}} onChange={onChange} />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(screen.getByRole("option", { name: "Ingreso" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "income" });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Categoría" }));
    fireEvent.click(screen.getByRole("option", { name: "Sin categorizar" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({ category: "uncategorized" });
    });
  });

  it("emits the currency selection as a filter (RF-013)", () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters categories={categories} value={{}} onChange={onChange} />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Moneda" }));
    fireEvent.click(screen.getByRole("option", { name: "USD" }));

    expect(onChange).toHaveBeenLastCalledWith({ currency: "USD" });
  });

  it("emits the period bounds as from/to filters (RF-013)", () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters categories={categories} value={{}} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-10-01" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-10-01" });

    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-10-31" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ to: "2026-10-31" });
  });

  it("clears a filter back to all as undefined", () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters
        categories={categories}
        value={{ type: "income", from: "2026-10-01" }}
        onChange={onChange}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(screen.getByRole("option", { name: "Todas" }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: undefined,
      from: "2026-10-01",
    });

    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      type: "income",
      from: undefined,
    });
  });
});
