import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Category } from "./category.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

describe("Category.createCustom (RF-040, RF-041)", () => {
  it("creates a workspace-owned active category", () => {
    const result = Category.createCustom({
      id: "cat-1",
      workspaceId: ws,
      key: "pets",
      label: "Mascotas",
      nature: "discretionary",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("cat-1");
    expect(result.value.key).toBe("pets");
    expect(result.value.label).toBe("Mascotas");
    expect(result.value.nature).toBe("discretionary");
    expect(result.value.archivedAt).toBeNull();
  });

  it("rejects keys outside the stable slug pattern", () => {
    for (const key of ["Mascotas", "con espacios", "", "a".repeat(65), "-lead"]) {
      const result = Category.createCustom({
        id: "cat-1",
        workspaceId: ws,
        key,
        label: "Mascotas",
        nature: "essential",
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("CATEGORY_KEY_INVALID");
    }
  });

  it("rejects empty or over-long labels", () => {
    for (const label of ["", "   ", "x".repeat(121)]) {
      const result = Category.createCustom({
        id: "cat-1",
        workspaceId: ws,
        key: "pets",
        label,
        nature: "essential",
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("CATEGORY_INVALID_LABEL");
    }
  });

  it("rejects a nature outside the financial set (RF-041)", () => {
    const result = Category.createCustom({
      id: "cat-1",
      workspaceId: ws,
      key: "pets",
      label: "Mascotas",
      nature: "uncategorized",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CATEGORY_INVALID_NATURE");
  });

  it("accepts the transfer conceptual nature (RF-041)", () => {
    const result = Category.createCustom({
      id: "cat-1",
      workspaceId: ws,
      key: "between_accounts",
      label: "Entre cuentas",
      nature: "transfer",
    });

    expect(result.ok).toBe(true);
  });
});

describe("Category.deriveKey", () => {
  it("slugs a label into a stable key", () => {
    expect(Category.deriveKey("Mascotas y Veterinaria")).toBe(
      "mascotas_y_veterinaria",
    );
    expect(Category.deriveKey("Alimentación  del Hogar!")).toBe(
      "alimentacion_del_hogar",
    );
  });
});

describe("Category.revise", () => {
  function makeCategory(): Category {
    const result = Category.createCustom({
      id: "cat-1",
      workspaceId: ws,
      key: "pets",
      label: "Mascotas",
      nature: "discretionary",
    });
    if (!result.ok) throw new Error("setup failed");
    return result.value;
  }

  it("applies label and nature changes", () => {
    const category = makeCategory();

    const result = category.revise({ label: "Mis mascotas", nature: "essential" });

    expect(result.ok).toBe(true);
    expect(category.label).toBe("Mis mascotas");
    expect(category.nature).toBe("essential");
  });

  it("rejects a revision without effective changes", () => {
    const category = makeCategory();

    const result = category.revise({ label: "Mascotas" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CATEGORY_NO_CHANGES");
  });
});

describe("Category.archive (RF-044)", () => {
  it("marks archivedAt without deleting the record", () => {
    const created = Category.createCustom({
      id: "cat-1",
      workspaceId: ws,
      key: "pets",
      label: "Mascotas",
      nature: "essential",
    });
    if (!created.ok) throw new Error("setup failed");
    const category = created.value;

    category.archive();

    expect(category.archivedAt).toBeInstanceOf(Date);
  });
});
