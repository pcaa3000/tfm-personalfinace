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

function chooseOption(comboboxName: string, optionName: string) {
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: comboboxName }),
  );
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("PreferencesDialog (S12-1, RF-003/RF-004)", () => {
  it("disables Guardar while the draft matches the workspace", () => {
    renderDialog();

    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toHaveProperty("disabled", true);
  });

  it("keeps select edits local until Guardar, then sends a single patch", () => {
    const { onPatch } = renderDialog();

    chooseOption("Zona horaria", "America/Bogota");
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ timezone: "America/Bogota" });
  });

  it("sends only the dirty fields when several selects changed", () => {
    const { onPatch } = renderDialog();

    chooseOption("Moneda por defecto", "USD");
    chooseOption("Zona horaria", "America/Lima");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({
      defaultCurrency: "USD",
      timezone: "America/Lima",
    });
  });

  it("re-disables Guardar when the draft is reverted to the workspace values", () => {
    renderDialog();

    chooseOption("Zona horaria", "America/Bogota");
    chooseOption("Zona horaria", "UTC");

    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toHaveProperty("disabled", true);
  });

  it("Cancelar closes the dialog without patching", () => {
    const { onPatch, onClose } = renderDialog();

    chooseOption("Zona horaria", "America/Bogota");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onPatch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
