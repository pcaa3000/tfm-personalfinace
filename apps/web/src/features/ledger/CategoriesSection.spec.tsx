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
import { CategoriesSection } from "./CategoriesSection";
import type { CategoryView } from "./types";

const categories: CategoryView[] = [
  {
    id: "cat-global",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: false,
  },
  {
    id: "cat-custom",
    key: "pets",
    label: "Mascotas",
    nature: "discretionary",
    custom: true,
  },
];

function renderSection(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onRevise: vi.fn(),
    onArchive: vi.fn(),
    ...overrides,
  };
  render(
    <CategoriesSection
      categories={categories}
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

describe("CategoriesSection (RF-040, RF-041, RF-044)", () => {
  it("creates a custom category with its financial nature", () => {
    const { onCreate } = renderSection();

    fireEvent.change(screen.getByLabelText("Nombre de la categoría"), {
      target: { value: "Vacaciones" },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Naturaleza" }));
    fireEvent.click(screen.getByRole("option", { name: "Discrecional" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Crear categoría" }),
    );

    expect(onCreate).toHaveBeenCalledWith({
      label: "Vacaciones",
      nature: "discretionary",
    });
  });

  it("shows edit and archive actions only for workspace categories", () => {
    const { onArchive } = renderSection();

    expect(
      screen.getAllByRole("button", { name: "Editar" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    expect(onArchive).toHaveBeenCalledWith("cat-custom");
  });

  it("lays out the create/edit form as a responsive single-column grid (L25)", () => {
    renderSection();

    const form = screen.getByTestId("category-form");
    // Responsive layout (L25): the form is a CSS grid (single column
    // on xs via gridTemplateColumns), not the overflowing flex row.
    expect(getComputedStyle(form).display).toBe("grid");
    expect(
      within(form).getByLabelText("Nombre de la categoría"),
    ).toBeTruthy();
    expect(
      within(form).getByRole("combobox", { name: "Naturaleza" }),
    ).toBeTruthy();
  });

  it("pins the create/edit form above the category list (L26)", () => {
    renderSection();

    const form = screen.getByTestId("category-form");
    const firstRow = screen.getByText("Comida");
    expect(
      form.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders category rows with responsive actions that do not overlap text (L26)", () => {
    renderSection();

    const rows = screen.getAllByTestId("manage-row");
    expect(getComputedStyle(rows[0]!).display).toBe("flex");
    expect(
      within(rows[1]!).getByRole("button", { name: "Editar" }),
    ).toBeTruthy();
  });

  it("revises a custom category label and nature", () => {
    const { onRevise } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Nombre de la categoría"), {
      target: { value: "Mis mascotas" },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Naturaleza" }));
    fireEvent.click(screen.getByRole("option", { name: "Esencial" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar cambios" }),
    );

    expect(onRevise).toHaveBeenCalledWith("cat-custom", {
      label: "Mis mascotas",
      nature: "essential",
    });
  });
});
