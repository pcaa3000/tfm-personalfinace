import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  UpdateDefaultCurrencyUseCase,
  type WorkspaceSettingsPort,
} from "./update-default-currency.use-case.js";
import type { WorkspaceContext } from "./workspace-context.port.js";

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

class FakeSettings implements WorkspaceSettingsPort {
  calls: string[] = [];
  async updateDefaultCurrency(
    workspaceId: WorkspaceId,
    currency: string,
  ): Promise<WorkspaceContext> {
    this.calls.push(currency);
    return {
      workspaceId,
      locale: "es-PE",
      timezone: "America/Lima",
      defaultCurrency: currency,
    };
  }
}

describe("UpdateDefaultCurrencyUseCase", () => {
  it("persists a valid currency and returns the updated context", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateDefaultCurrencyUseCase(settings);

    const result = await useCase.execute(ws.value, "USD");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultCurrency).toBe("USD");
    }
    expect(settings.calls).toEqual(["USD"]);
  });

  it("rejects an invalid currency without touching persistence", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateDefaultCurrencyUseCase(settings);

    const result = await useCase.execute(ws.value, "XX");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    }
    expect(settings.calls).toHaveLength(0);
  });
});
