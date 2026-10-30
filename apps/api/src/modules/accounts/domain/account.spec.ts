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

  it("accepts cash and wallet kinds", () => {
    for (const kind of ["cash", "wallet"]) {
      const result = Account.create({ ...baseInput, kind });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe(kind);
      }
    }
  });
});
