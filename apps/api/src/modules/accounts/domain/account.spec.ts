import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Account } from "./account.js";

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

const baseInput = {
  id: "acc-1",
  workspaceId: ws.value,
  name: "BCP soles",
  currency: "PEN",
  kind: "bank",
};

describe("Account.create", () => {
  it("creates an account with a trimmed name and valid currency", () => {
    const result = Account.create({ ...baseInput, name: "  BCP soles  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("BCP soles");
      expect(result.value.currency.code).toBe("PEN");
      expect(result.value.kind).toBe("bank");
      expect(result.value.archivedAt).toBeNull();
    }
  });

  it("rejects an empty name", () => {
    const result = Account.create({ ...baseInput, name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_INVALID_NAME");
    }
  });

  it("rejects a name longer than 64 chars", () => {
    const result = Account.create({ ...baseInput, name: "x".repeat(65) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_INVALID_NAME");
    }
  });

  it("rejects an invalid kind", () => {
    const result = Account.create({ ...baseInput, kind: "crypto" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_INVALID_KIND");
    }
  });

  it("rejects an invalid currency code", () => {
    const result = Account.create({ ...baseInput, currency: "XX" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    }
  });

  it("accepts the cash kind", () => {
    const result = Account.create({ ...baseInput, kind: "cash" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("cash");
    }
  });
});

describe("Account.create instrument kinds", () => {
  it("accepts the full set of instrument kinds", () => {
    for (const kind of [
      "cash",
      "bank",
      "savings",
      "credit_card",
      "virtual",
      "investment",
      "loan",
      "insurance",
    ]) {
      const result = Account.create({ ...baseInput, kind });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe(kind);
      }
    }
  });

  it("rejects the legacy wallet kind", () => {
    const result = Account.create({ ...baseInput, kind: "wallet" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_INVALID_KIND");
    }
  });
});

describe("Account.create initialBalance", () => {
  it("defaults to zero in the account currency", () => {
    const result = Account.create(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.initialBalance.toDecimalString()).toBe("0.00");
      expect(result.value.initialBalance.currency.code).toBe("PEN");
    }
  });

  it("accepts a non-negative initial balance in the account currency", async () => {
    const { Money } = await import("../../shared-kernel/index.js");
    const money = Money.create("250.75", "PEN");
    if (!money.ok) throw new Error("setup failed");
    const result = Account.create({ ...baseInput, initialBalance: money.value });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.initialBalance.toDecimalString()).toBe("250.75");
    }
  });

  it("rejects a negative initial balance (INV-CTA-04)", async () => {
    const { Money } = await import("../../shared-kernel/index.js");
    const money = Money.create("-1.00", "PEN");
    if (!money.ok) throw new Error("setup failed");
    const result = Account.create({ ...baseInput, initialBalance: money.value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NEGATIVE_INITIAL_BALANCE");
    }
  });

  it("rejects an initial balance in another currency", async () => {
    const { Money } = await import("../../shared-kernel/index.js");
    const money = Money.create("10.00", "USD");
    if (!money.ok) throw new Error("setup failed");
    const result = Account.create({ ...baseInput, initialBalance: money.value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
  });
});

describe("Account.revise", () => {
  it("changes name, kind and initial balance", async () => {
    const { Money } = await import("../../shared-kernel/index.js");
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const balance = Money.create("500.00", "PEN");
    if (!balance.ok) throw new Error("setup failed");

    const result = created.value.revise({
      name: "BCP principal",
      kind: "savings",
      initialBalance: balance.value,
    });

    expect(result.ok).toBe(true);
    expect(created.value.name).toBe("BCP principal");
    expect(created.value.kind).toBe("savings");
    expect(created.value.initialBalance.toDecimalString()).toBe("500.00");
  });

  it("rejects a revision without any change", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const result = created.value.revise({
      name: "BCP soles",
      kind: "bank",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NO_CHANGES");
    }
  });

  it("rejects revising an archived account", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const archived = created.value.archive();
    expect(archived.ok).toBe(true);

    const result = created.value.revise({ name: "otro" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_ALREADY_ARCHIVED");
    }
  });
});

describe("Account.archive", () => {
  it("marks the account as archived", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const result = created.value.archive();
    expect(result.ok).toBe(true);
    expect(created.value.archivedAt).not.toBeNull();
  });

  it("rejects archiving an already archived account", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    created.value.archive();
    const result = created.value.archive();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_ALREADY_ARCHIVED");
    }
  });
});

describe("Account.unarchive (T25)", () => {
  it("restores an archived account to active", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    created.value.archive();
    const result = created.value.unarchive();
    expect(result.ok).toBe(true);
    expect(created.value.archivedAt).toBeNull();
  });

  it("rejects unarchiving an active account", () => {
    const created = Account.create(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const result = created.value.unarchive();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_ARCHIVED");
    }
  });
});
