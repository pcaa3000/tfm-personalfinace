import { describe, expect, it } from "vitest";

import { deriveCategoryKey, findReusableCategory } from "./category-key";
import type { CategoryView } from "./types";

const categories: CategoryView[] = [
  {
    id: "cat-pets",
    key: "mascotas",
    label: "Mascotas",
    nature: "discretionary",
    custom: true,
  },
];

describe("deriveCategoryKey (T8, S8 — mirrors Category.deriveKey)", () => {
  it("slugs a label the same way the API does", () => {
    expect(deriveCategoryKey("Mascotas y Veterinaria")).toBe(
      "mascotas_y_veterinaria",
    );
    expect(deriveCategoryKey("Alimentación  del Hogar!")).toBe(
      "alimentacion_del_hogar",
    );
  });
});

describe("findReusableCategory (T8, S8 — create-or-reuse)", () => {
  it("returns the category whose key the label derives to", () => {
    expect(findReusableCategory("Mascotas", categories)?.id).toBe("cat-pets");
    expect(findReusableCategory("  MASCOTAS  ", categories)?.id).toBe(
      "cat-pets",
    );
  });

  it("returns null when no category holds the derived key", () => {
    expect(findReusableCategory("Viajes", categories)).toBeNull();
    expect(findReusableCategory("Mascotas", [])).toBeNull();
  });
});
