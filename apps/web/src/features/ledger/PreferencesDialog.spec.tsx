// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import i18n from "../../i18n";
import { getVoiceConsent, setVoiceConsent } from "./api";
import { PreferencesDialog } from "./PreferencesDialog";
import type { WorkspaceView } from "./types";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    getVoiceConsent: vi.fn(),
    setVoiceConsent: vi.fn(),
  };
});

const workspace: WorkspaceView = {
  workspaceId: "ws-1",
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

beforeEach(() => {
  vi.mocked(getVoiceConsent).mockReset().mockResolvedValue({
    provider: "gemini",
    granted: true,
    grantedAt: "2026-10-01T00:00:00.000Z",
    revokedAt: null,
  });
  vi.mocked(setVoiceConsent).mockReset().mockResolvedValue({
    provider: "gemini",
    granted: false,
    grantedAt: "2026-10-01T00:00:00.000Z",
    revokedAt: "2026-11-10T12:00:00.000Z",
  });
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

  it("shows the voice provider consent and revokes it via the switch (T5, S6)", async () => {
    renderDialog();

    const toggle = await screen.findByRole("switch", {
      name: "Voz — envío de audio a Google Gemini",
    });
    expect(toggle).toHaveProperty("checked", true);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setVoiceConsent).toHaveBeenCalledWith(false);
    });
  });

  it("re-grants a revoked consent from the same switch", async () => {
    vi.mocked(getVoiceConsent).mockResolvedValue({
      provider: "gemini",
      granted: false,
      grantedAt: "2026-10-01T00:00:00.000Z",
      revokedAt: "2026-11-01T00:00:00.000Z",
    });
    renderDialog();

    const toggle = await screen.findByRole("switch", {
      name: "Voz — envío de audio a Google Gemini",
    });
    expect(toggle).toHaveProperty("checked", false);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setVoiceConsent).toHaveBeenCalledWith(true);
    });
  });
});
