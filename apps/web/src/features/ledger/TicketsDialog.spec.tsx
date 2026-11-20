// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { deleteReceiptFile, listReceipts } from "./api";
import { TicketsDialog } from "./TicketsDialog";
import type { ReceiptListItemView } from "./receipt-draft";

vi.mock("./api", async (importOriginal) => {
  // Keep the real ApiError class — errorMessage() instanceof-checks it.
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listReceipts: vi.fn(),
    deleteReceiptFile: vi.fn(),
  };
});

const linked: ReceiptListItemView = {
  id: "rc-1",
  status: "confirmed",
  originalFilename: "boleta.jpg",
  fileMimeType: "image/jpeg",
  createdAt: "2026-10-05T15:30:00.000Z",
  transactionId: "tx-9",
  expiresAt: "2026-11-04T15:30:00.000Z",
  mediaDeletedAt: null,
};

const unlinked: ReceiptListItemView = {
  id: "rc-2",
  status: "draft_ready",
  originalFilename: "ticket.png",
  fileMimeType: "image/png",
  createdAt: "2026-10-04T10:00:00.000Z",
  transactionId: null,
  expiresAt: "2026-11-03T10:00:00.000Z",
  mediaDeletedAt: null,
};

const mediaGone: ReceiptListItemView = {
  id: "rc-3",
  status: "confirmed",
  originalFilename: "viejo.jpg",
  fileMimeType: "image/jpeg",
  createdAt: "2026-09-01T09:00:00.000Z",
  transactionId: "tx-7",
  expiresAt: "2026-10-01T09:00:00.000Z",
  mediaDeletedAt: "2026-10-02T12:00:00.000Z",
};

function renderDialog(open = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TicketsDialog open={open} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  vi.mocked(listReceipts).mockReset();
  vi.mocked(deleteReceiptFile).mockReset();
});

afterEach(cleanup);

describe("TicketsDialog (receipt-review-link T4, S1+S3)", () => {
  it("does not fetch receipts while the dialog is closed", () => {
    renderDialog(false);

    expect(listReceipts).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the empty state when the workspace has no scans", async () => {
    vi.mocked(listReceipts).mockResolvedValue([]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    expect(
      await within(dialog).findByText("Todavía no hay tickets cargados."),
    ).toBeTruthy();
  });

  it("lists scans with filename, date, localized status and image link", async () => {
    vi.mocked(listReceipts).mockResolvedValue([linked, unlinked]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const rows = await within(dialog).findAllByTestId("manage-row");
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText(/boleta\.jpg/)).toBeTruthy();
    expect(first.getByText(/\/10\/2026/)).toBeTruthy();
    expect(first.getByText("Confirmado")).toBeTruthy();

    const imageLinks = within(dialog).getAllByRole("link", {
      name: "Ver imagen",
    });
    expect(imageLinks[0]!.getAttribute("href")).toBe(
      "/api/v1/receipts/rc-1/file",
    );
    expect(imageLinks[0]!.getAttribute("target")).toBe("_blank");
    expect(imageLinks[1]!.getAttribute("href")).toBe(
      "/api/v1/receipts/rc-2/file",
    );
  });

  it("shows the linked-movement badge only when transactionId is present", async () => {
    vi.mocked(listReceipts).mockResolvedValue([linked, unlinked]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const rows = await within(dialog).findAllByTestId("manage-row");

    expect(
      within(rows[0]!).getByText("Vinculado a un movimiento"),
    ).toBeTruthy();
    expect(
      within(rows[1]!).queryByText("Vinculado a un movimiento"),
    ).toBeNull();
    expect(within(rows[1]!).getByText("Borrador listo")).toBeTruthy();
  });

  it("surfaces the fetch error and retries on demand", async () => {
    vi.mocked(listReceipts).mockRejectedValueOnce(new Error("boom"));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    expect(
      await within(dialog).findByText("No se pudieron cargar los tickets."),
    ).toBeTruthy();

    vi.mocked(listReceipts).mockResolvedValue([unlinked]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reintentar" }),
    );

    expect(await within(dialog).findByText(/ticket\.png/)).toBeTruthy();
    expect(listReceipts).toHaveBeenCalledTimes(2);
  });
});

describe("media retention (receipt-retention-30d T5, S3+S5)", () => {
  it("shows the localized media expiry of each scan", async () => {
    vi.mocked(listReceipts).mockResolvedValue([linked, unlinked]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const rows = await within(dialog).findAllByTestId("manage-row");
    expect(within(rows[0]!).getByText(/Vence: \d{2}\/11\/2026/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/Vence: \d{2}\/11\/2026/)).toBeTruthy();
  });

  it("deletes the media after inline confirmation and updates the row", async () => {
    vi.mocked(listReceipts).mockResolvedValue([linked]);
    vi.mocked(deleteReceiptFile).mockResolvedValue(undefined);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const row = (await within(dialog).findAllByTestId("manage-row"))[0]!;

    fireEvent.click(
      within(row).getByRole("button", { name: "Eliminar medio" }),
    );

    // The API is only called once the user confirms.
    expect(deleteReceiptFile).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", {
      name: "Eliminar medio del ticket",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Eliminar" }),
    );

    await waitFor(() =>
      expect(deleteReceiptFile).toHaveBeenCalledWith("rc-1"),
    );

    // The row switches to the deleted state: image link and delete
    // affordance gone, linked-movement chip intact (CA-012).
    const updated = (await within(dialog).findAllByTestId("manage-row"))[0]!;
    expect(await within(updated).findByText("Medio eliminado")).toBeTruthy();
    expect(
      within(updated).queryByRole("link", { name: "Ver imagen" }),
    ).toBeNull();
    expect(
      within(updated).queryByRole("button", { name: "Eliminar medio" }),
    ).toBeNull();
    expect(
      within(updated).getByText("Vinculado a un movimiento"),
    ).toBeTruthy();
  });

  it("renders the deleted state when mediaDeletedAt is already set", async () => {
    vi.mocked(listReceipts).mockResolvedValue([mediaGone]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const row = (await within(dialog).findAllByTestId("manage-row"))[0]!;
    expect(within(row).getByText("Medio eliminado")).toBeTruthy();
    expect(
      within(row).queryByRole("link", { name: "Ver imagen" }),
    ).toBeNull();
    expect(
      within(row).queryByRole("button", { name: "Eliminar medio" }),
    ).toBeNull();
    // CA-012: the linked transaction survives the media deletion.
    expect(
      within(row).getByText("Vinculado a un movimiento"),
    ).toBeTruthy();
    expect(deleteReceiptFile).not.toHaveBeenCalled();
  });

  it("surfaces a localized error when the deletion fails", async () => {
    vi.mocked(listReceipts).mockResolvedValue([linked]);
    vi.mocked(deleteReceiptFile).mockRejectedValue(new Error("boom"));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const row = (await within(dialog).findAllByTestId("manage-row"))[0]!;

    fireEvent.click(
      within(row).getByRole("button", { name: "Eliminar medio" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Eliminar medio del ticket",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Eliminar" }),
    );

    expect(
      await within(confirm).findByText(
        "No se pudo completar la operación. Intentá de nuevo.",
      ),
    ).toBeTruthy();

    // Cancel dismisses the confirm; the row keeps the live state.
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Eliminar medio del ticket" }),
      ).toBeNull(),
    );
    const stillLive = (await within(dialog).findAllByTestId("manage-row"))[0]!;
    expect(within(stillLive).queryByText("Medio eliminado")).toBeNull();
    expect(
      within(stillLive).getByRole("link", { name: "Ver imagen" }),
    ).toBeTruthy();
    expect(within(stillLive).getByText(/Vence:/)).toBeTruthy();
  });
});
