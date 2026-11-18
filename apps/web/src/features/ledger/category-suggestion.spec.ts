import { describe, expect, it } from "vitest";

import { suggestCategoryForConcept } from "./category-suggestion";
import type { CategoryView } from "./types";

const categories: CategoryView[] = [
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
  {
    id: "cat-pets",
    key: "pets_and_vets",
    label: "Mascotas",
    nature: "discretionary",
    custom: true,
  },
];

describe("suggestCategoryForConcept (T8, D1b — system-one suggestion)", () => {
  it("returns null for a blank concept or an empty catalog", () => {
    expect(suggestCategoryForConcept("", categories)).toBeNull();
    expect(suggestCategoryForConcept("   ", categories)).toBeNull();
    expect(suggestCategoryForConcept("comida", [])).toBeNull();
  });

  it("matches a concept token against the category label", () => {
    expect(suggestCategoryForConcept("Comida rápida", categories)?.id).toBe(
      "cat-food",
    );
  });

  it("ignores diacritics and case on both sides", () => {
    expect(suggestCategoryForConcept("CAFE con leche", categories)?.id).toBe(
      "cat-rest",
    );
  });

  it("matches a concept token that prefixes a category keyword", () => {
    expect(
      suggestCategoryForConcept("Pago del restaurante", categories)?.id,
    ).toBe("cat-rest");
  });

  it("matches against the catalog key as well as the label", () => {
    expect(suggestCategoryForConcept("food delivery", categories)?.id).toBe(
      "cat-food",
    );
  });

  it("ignores tokens shorter than four characters", () => {
    expect(suggestCategoryForConcept("té y pan", categories)).toBeNull();
  });

  it("prefers the longest matching keyword over a weaker prefix hit", () => {
    const catalog: CategoryView[] = [
      {
        id: "cat-cafe",
        key: "cafe",
        label: "Café",
        nature: "discretionary",
        custom: true,
      },
      {
        id: "cat-cafeteria",
        key: "cafeteria",
        label: "Cafetería",
        nature: "discretionary",
        custom: true,
      },
    ];

    expect(suggestCategoryForConcept("cafetería del barrio", catalog)?.id).toBe(
      "cat-cafeteria",
    );
  });

  it("keeps catalog order when candidates tie", () => {
    const catalog: CategoryView[] = [
      {
        id: "cat-first",
        key: "mascotas",
        label: "Mascotas",
        nature: "discretionary",
        custom: true,
      },
      {
        id: "cat-second",
        key: "mascotas_vet",
        label: "Mascotas y veterinaria",
        nature: "discretionary",
        custom: true,
      },
    ];

    // A longer keyword hit wins over the tied shorter one…
    expect(
      suggestCategoryForConcept("veterinaria de mascotas", catalog)?.id,
    ).toBe("cat-second");
    // …and equal scores keep catalog order.
    expect(suggestCategoryForConcept("mascotas", catalog)?.id).toBe(
      "cat-first",
    );
  });
});
