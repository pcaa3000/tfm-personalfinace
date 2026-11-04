// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { PreferencesDialog } from "./PreferencesDialog";
import type { WorkspaceView } from "./types";

const workspace: WorkspaceView = {
  workspaceId: "ws-1",
  locale: "es-PE",
  timezone: "UTC",
  defaultCurrency: "PEN",
};

function renderDialog(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onPatch: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <PreferencesDialog
      open
      workspace={workspace}
      currencies={["PEN", "USD"]}
      submitting={false}
      error={null}
      onClose={handlers.onClose}
      onPatch={handlers.onPatch}
    />,
  );
  return handlers;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("PreferencesDialog (S12-1, RF-003/RF-004)", () => {
  it("patches the timezone when it changes", () => {
    const { onPatch } = renderDialog();

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Zona horaria" }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: "America/Bogota" }),
    );

    expect(onPatch).toHaveBeenCalledWith({ timezone: "America/Bogota" });
  });

  it("patches the default currency using workspace currencies only", () => {
    const { onPatch } = renderDialog();

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Moneda por defecto" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "USD" }));

    expect(onPatch).toHaveBeenCalledWith({ defaultCurrency: "USD" });
  });

  it("patches the locale", () => {
    const { onPatch } = renderDialog();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Locale" }));
    fireEvent.click(screen.getByRole("option", { name: "en-US" }));

    expect(onPatch).toHaveBeenCalledWith({ locale: "en-US" });
  });
});
