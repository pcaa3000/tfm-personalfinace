// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
