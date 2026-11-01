// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { TransactionFilters } from "./TransactionFilters";

const categories = [
  { id: "cat-food", key: "food", label: "Comida", nature: "essential" },
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
});
