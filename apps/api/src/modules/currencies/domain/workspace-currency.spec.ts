import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { WorkspaceCurrency } from "./workspace-currency.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function stored(code = "PEN"): WorkspaceCurrency {
  const created = WorkspaceCurrency.create({
    id: "cur-1",
    workspaceId: ws,
    code,
  });
  if (!created.ok) throw new Error("setup failed");
  return created.value;
}

describe("WorkspaceCurrency.create (INV-MON-01)", () => {
  it.each(["PEN", "USD", "JPY", "BHD", "CLF"])(
    "accepts the ISO 4217 code %s",
    (code) => {
      const result = WorkspaceCurrency.create({
        id: "cur-1",
        workspaceId: ws,
        code,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.code.code).toBe(code);
      expect(result.value.archivedAt).toBeNull();
    },
  );

  it.each(["CHP", "ZZZ", "ABC"])(
    "rejects well-formed code %s absent from the ISO table",
    (code) => {
      const result = WorkspaceCurrency.create({
        id: "cur-1",
        workspaceId: ws,
        code,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("CURRENCY_UNKNOWN_ISO");
    },
  );

  it.each(["pen", "PE", "PENN", "U51", "123"])(
    "rejects malformed code %j",
    (code) => {
      const result = WorkspaceCurrency.create({
        id: "cur-1",
        workspaceId: ws,
        code,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    },
  );
});

describe("WorkspaceCurrency.changeCode (INV-MON-04)", () => {
  it("changes the code to another known ISO code", () => {
    const currency = stored("PEN");

    const result = currency.changeCode("EUR");

    expect(result.ok).toBe(true);
    expect(currency.code.code).toBe("EUR");
  });

  it("rejects a code absent from the ISO table", () => {
    const currency = stored("PEN");

    const result = currency.changeCode("CHP");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_UNKNOWN_ISO");
    expect(currency.code.code).toBe("PEN");
  });

  it("rejects a no-op change", () => {
    const currency = stored("PEN");

    const result = currency.changeCode("PEN");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_NO_CHANGES");
  });

  it("rejects changes on an archived currency", () => {
    const currency = stored("PEN");
    currency.archive();

    const result = currency.changeCode("EUR");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_ALREADY_ARCHIVED");
  });
});

describe("WorkspaceCurrency.archive", () => {
  it("marks the currency as archived", () => {
    const currency = stored("PEN");

    const result = currency.archive();

    expect(result.ok).toBe(true);
    expect(currency.archivedAt).toBeInstanceOf(Date);
  });

  it("rejects archiving twice", () => {
    const currency = stored("PEN");
    currency.archive();

    const result = currency.archive();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_ALREADY_ARCHIVED");
  });
});

describe("WorkspaceCurrency.reconstitute", () => {
  it("restores persisted state", () => {
    const currency = WorkspaceCurrency.reconstitute({
      id: "cur-9",
      workspaceId: ws,
      code: "USD",
      archivedAt: new Date("2026-11-04T00:00:00Z"),
    });

    expect(currency.id).toBe("cur-9");
    expect(currency.code.code).toBe("USD");
    expect(currency.archivedAt?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });
});
