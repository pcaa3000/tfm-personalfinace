import { describe, expect, it } from "vitest";

import { ListIsoCatalogUseCase } from "./list-iso-catalog.use-case.js";

describe("ListIsoCatalogUseCase (S12 — catálogo ISO buscable)", () => {
  const useCase = new ListIsoCatalogUseCase();

  it("exposes the full ISO 4217 table with localizable names", () => {
    const catalog = useCase.execute();

    expect(catalog.length).toBeGreaterThanOrEqual(160);
    for (const entry of catalog) {
      expect(entry.code).toMatch(/^[A-Z]{3}$/);
      expect(entry.nameEn.length).toBeGreaterThan(0);
      expect(entry.nameEs.length).toBeGreaterThan(0);
    }
    const codes = catalog.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("contains PEN with names and the ISO minor unit exponent", () => {
    const catalog = useCase.execute();
    const pen = catalog.find((c) => c.code === "PEN");

    expect(pen).toBeDefined();
    expect(pen?.nameEn).toBe("Sol");
    expect(pen?.nameEs).toBe("Sol");
    expect(pen?.minorUnitExponent).toBe(2);
  });

  it.each([
    ["USD", "US Dollar", "Dólar estadounidense", 2],
    ["JPY", "Yen", "Yen", 0],
    ["BHD", "Bahraini Dinar", "Dinar bareiní", 3],
    ["CLF", "Unidad de Fomento", "Unidad de Fomento", 4],
  ])(
    "exposes %s with EN/ES names and exponent %i",
    (code, nameEn, nameEs, exponent) => {
      const entry = useCase.execute().find((c) => c.code === code);

      expect(entry).toBeDefined();
      expect(entry?.nameEn).toBe(nameEn);
      expect(entry?.nameEs).toBe(nameEs);
      expect(entry?.minorUnitExponent).toBe(exponent);
    },
  );
});
