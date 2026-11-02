import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  UpdateWorkspacePreferencesUseCase,
  type WorkspacePreferencesPatch,
  type WorkspaceSettingsPort,
} from "./update-workspace-preferences.use-case.js";
import type { WorkspaceContext } from "./workspace-context.port.js";

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

class FakeSettings implements WorkspaceSettingsPort {
  calls: WorkspacePreferencesPatch[] = [];
  async updatePreferences(
    workspaceId: WorkspaceId,
    patch: WorkspacePreferencesPatch,
  ): Promise<WorkspaceContext> {
    this.calls.push(patch);
    return {
      workspaceId,
      locale: patch.locale ?? "es-PE",
      timezone: patch.timezone ?? "America/Lima",
      defaultCurrency: patch.defaultCurrency ?? "PEN",
    };
  }
}

describe("UpdateWorkspacePreferencesUseCase (RF-003, RF-004)", () => {
  it("persists a valid currency patch", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, {
      defaultCurrency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(settings.calls).toEqual([{ defaultCurrency: "USD" }]);
  });

  it("persists timezone and locale patches", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, {
      timezone: "America/Lima",
      locale: "es-PE",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timezone).toBe("America/Lima");
      expect(result.value.locale).toBe("es-PE");
    }
    expect(settings.calls).toEqual([
      { timezone: "America/Lima", locale: "es-PE" },
    ]);
  });

  it("rejects an invalid currency without touching persistence", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, {
      defaultCurrency: "XX",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    }
    expect(settings.calls).toHaveLength(0);
  });

  it("rejects an invalid IANA timezone without touching persistence", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, {
      timezone: "Mars/Olympus_Mons",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TIMEZONE_INVALID");
    }
    expect(settings.calls).toHaveLength(0);
  });

  it("rejects an invalid locale without touching persistence", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, { locale: "!!bad!!" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LOCALE_INVALID");
    }
    expect(settings.calls).toHaveLength(0);
  });

  it("rejects an empty patch", async () => {
    const settings = new FakeSettings();
    const useCase = new UpdateWorkspacePreferencesUseCase(settings);

    const result = await useCase.execute(ws.value, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKSPACE_NO_CHANGES");
    }
    expect(settings.calls).toHaveLength(0);
  });
});
