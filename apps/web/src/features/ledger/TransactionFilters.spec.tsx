// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList => ({
      matches: query.includes("min-width") ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  mockMatchMedia(true); // desktop (≥960px) by default
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

  it("emits transfer as a type filter (S12-3)", async () => {
    const onChange = vi.fn();
    render(
      <TransactionFilters categories={categories} value={{}} onChange={onChange} />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }));
    fireEvent.click(
      screen.getByRole("option", { name: "Transferencia" }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({ type: "transfer" });
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

  it("shows a localized placeholder in the search field (S7)", () => {
    render(
      <TransactionFilters categories={categories} value={{}} onChange={vi.fn()} />,
    );

    expect(screen.getByPlaceholderText("Buscar concepto…")).toBeTruthy();
  });

  describe("period shortcuts (S5)", () => {
    it("sets the current-month range keeping the other filters", () => {
      const onChange = vi.fn();
      render(
        <TransactionFilters
          categories={categories}
          value={{ q: "lunch" }}
          onChange={onChange}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Mes en curso" }),
      );

      const now = new Date();
      const y = now.getFullYear();
      const m = pad(now.getMonth() + 1);
      const lastDay = pad(new Date(y, now.getMonth() + 1, 0).getDate());
      expect(onChange).toHaveBeenLastCalledWith({
        q: "lunch",
        from: `${y}-${m}-01`,
        to: `${y}-${m}-${lastDay}`,
      });
    });

    it("sets a rolling 30-day range ending today", () => {
      const onChange = vi.fn();
      render(
        <TransactionFilters
          categories={categories}
          value={{}}
          onChange={onChange}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Últimos 30 días" }),
      );

      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 29);
      expect(onChange).toHaveBeenLastCalledWith({
        from: isoDate(from),
        to: isoDate(to),
      });
    });
  });

  describe("mobile layout (<960px, S4)", () => {
    it("keeps search visible and collapses the rest behind a toggle", async () => {
      mockMatchMedia(false);
      render(
        <TransactionFilters
          categories={categories}
          value={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("Buscar concepto")).toBeTruthy();
      const toggle = screen.getByRole("button", { name: "Filtros" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByLabelText("Desde")).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Tipo" })).toBeNull();

      fireEvent.click(toggle);

      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      await waitFor(() => {
        expect(screen.getByLabelText("Desde")).toBeTruthy();
        expect(
          screen.getByRole("combobox", { name: "Tipo" }),
        ).toBeTruthy();
      });
    });

    it("offers the period shortcuts inside the collapsible panel", async () => {
      mockMatchMedia(false);
      const onChange = vi.fn();
      render(
        <TransactionFilters
          categories={categories}
          value={{}}
          onChange={onChange}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Mes en curso" }),
      ).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
      const shortcut = await screen.findByRole("button", {
        name: "Últimos 30 días",
      });
      fireEvent.click(shortcut);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.any(String) }),
      );
    });
  });
});
