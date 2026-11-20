// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { NewMovementDialog } from "./NewMovementDialog";
import type { AccountView, CategoryView } from "./types";

const accounts: AccountView[] = [
  {
    id: "acc-pen",
    workspaceId: "ws-1",
    name: "BCP soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

const categories: CategoryView[] = [];

function renderDialog() {
  render(
    <NewMovementDialog
      open
      categories={categories}
      accounts={accounts}
      defaultCurrency="PEN"
      currencies={["PEN"]}
      submitting={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      onReceiptConfirmed={vi.fn()}
      onVoiceConfirmed={vi.fn()}
    />,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("NewMovementDialog — voice entry (voice-drafts T4, S1)", () => {
  it("offers the \"Voz / micrófono\" quick action next to the ticket entry", () => {
    renderDialog();

    expect(screen.getByText("Ticket / foto")).toBeTruthy();
    expect(screen.getByText("Voz / micrófono")).toBeTruthy();
  });

  it("opens the voice record step when the voice entry is picked", async () => {
    renderDialog();

    fireEvent.click(screen.getByText("Voz / micrófono"));

    // The record step renders — no file picker, no camera.
    expect(
      await screen.findByRole("button", { name: "Grabar" }),
    ).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
