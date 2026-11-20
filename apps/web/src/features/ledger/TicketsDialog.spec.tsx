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
import {
  ApiError,
  deleteReceiptFile,
  getReceiptFile,
  listReceipts,
  purgeReceiptMedia,
} from "./api";
import { TicketsDialog } from "./TicketsDialog";
import type {
  ReceiptListItemView,
  ReceiptListPageView,
} from "./receipt-draft";

vi.mock("./api", async (importOriginal) => {
  // Keep the real ApiError class — errorMessage() instanceof-checks it.
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listReceipts: vi.fn(),
    getReceiptFile: vi.fn(),
    deleteReceiptFile: vi.fn(),
    purgeReceiptMedia: vi.fn(),
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

function page(
  items: ReceiptListItemView[],
  nextCursor: string | null = null,
): ReceiptListPageView {
  return { items, nextCursor };
}

const createObjectURL = vi.fn(() => "blob:receipt-image");
const revokeObjectURL = vi.fn();

/** Points every media query at `matchesQuery` (default: no match). */
function stubMatchMedia(matchesQuery = "no-media-query-matches") {
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: query === matchesQuery,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

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
  // jsdom has no URL.createObjectURL — stub it for the image viewer.
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  vi.mocked(listReceipts).mockReset();
  vi.mocked(getReceiptFile).mockReset();
  vi.mocked(deleteReceiptFile).mockReset();
  vi.mocked(purgeReceiptMedia).mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

afterEach(() => {
  stubMatchMedia();
  cleanup();
});

describe("TicketsDialog (receipt-review-link T4, S1+S3)", () => {
  it("does not fetch receipts while the dialog is closed", () => {
    renderDialog(false);

    expect(listReceipts).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the empty state when the workspace has no scans", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    expect(
      await within(dialog).findByText("Todavía no hay tickets cargados."),
    ).toBeTruthy();
  });

  it("lists scans with filename, date, localized status and a view action", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked, unlinked]));

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

    // L28: the image opens in the in-app viewer — the raw API URL was
    // unauthenticated (401) and no link to it may survive.
    const viewActions = within(dialog).getAllByRole("button", {
      name: "Ver imagen",
    });
    expect(viewActions).toHaveLength(2);
    expect(dialog.querySelector('a[href^="/api/"]')).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Ver imagen" }),
    ).toBeNull();
  });

  it("shows the linked-movement badge only when transactionId is present", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked, unlinked]));

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

    vi.mocked(listReceipts).mockResolvedValue(page([unlinked]));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reintentar" }),
    );

    expect(await within(dialog).findByText(/ticket\.png/)).toBeTruthy();
    expect(listReceipts).toHaveBeenCalledTimes(2);
  });
});

describe("authenticated image viewer (receipt-review-link T6, L28)", () => {
  it("opens an in-app viewer that shows the fetched blob via object URL", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(getReceiptFile).mockResolvedValue(
      new Blob(["img"], { type: "image/jpeg" }),
    );

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Ver imagen" }),
    );

    expect(getReceiptFile).toHaveBeenCalledWith("rc-1");
    const viewer = await screen.findByRole("dialog", { name: "boleta.jpg" });
    const img = await within(viewer).findByRole("img");
    expect(img.getAttribute("src")).toBe("blob:receipt-image");
    // "Abrir en pestaña" exposes the local blob URL — never the API path.
    const tabLink = within(viewer).getByRole("link", {
      name: "Abrir en pestaña",
    });
    expect(tabLink.getAttribute("href")).toBe("blob:receipt-image");
    expect(viewer.querySelector('a[href^="/api/"]')).toBeNull();
  });

  it("revokes the object URL when the viewer closes", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(getReceiptFile).mockResolvedValue(new Blob(["img"]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Ver imagen" }),
    );
    const viewer = await screen.findByRole("dialog", { name: "boleta.jpg" });
    await within(viewer).findByRole("img");

    fireEvent.click(
      within(viewer).getByRole("button", { name: "Cerrar" }),
    );

    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-image"),
    );
  });

  it("shows the localized deleted copy when the file answers 410", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(getReceiptFile).mockRejectedValue(
      new ApiError("RECEIPT_MEDIA_GONE", "gone", 410),
    );

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Ver imagen" }),
    );

    const viewer = await screen.findByRole("dialog", { name: "boleta.jpg" });
    expect(
      await within(viewer).findByText(
        "El archivo de este ticket ya fue eliminado.",
      ),
    ).toBeTruthy();
    expect(within(viewer).queryByRole("img")).toBeNull();
  });

  it("surfaces a generic localized error and retries on demand", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(getReceiptFile).mockRejectedValueOnce(new Error("boom"));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Ver imagen" }),
    );

    const viewer = await screen.findByRole("dialog", { name: "boleta.jpg" });
    expect(
      await within(viewer).findByText(
        "No se pudo completar la operación. Intentá de nuevo.",
      ),
    ).toBeTruthy();

    vi.mocked(getReceiptFile).mockResolvedValue(new Blob(["img"]));
    fireEvent.click(
      within(viewer).getByRole("button", { name: "Reintentar" }),
    );

    expect(await within(viewer).findByRole("img")).toBeTruthy();
    expect(getReceiptFile).toHaveBeenCalledTimes(2);
  });
});

describe("cursor pagination (receipt-review-link T7, S1+S4)", () => {
  it("appends the next page when pressing 'Cargar más'", async () => {
    vi.mocked(listReceipts)
      .mockResolvedValueOnce(page([linked], "cur-2"))
      .mockResolvedValueOnce(page([unlinked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    expect(await within(dialog).findByText(/boleta\.jpg/)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cargar más" }),
    );

    expect(await within(dialog).findByText(/ticket\.png/)).toBeTruthy();
    expect(listReceipts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cur-2" }),
    );
    // No cursor left → the button disappears.
    expect(
      within(dialog).queryByRole("button", { name: "Cargar más" }),
    ).toBeNull();
  });

  it("hides 'Cargar más' when the first page has no next cursor", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    await within(dialog).findByText(/boleta\.jpg/);
    expect(
      within(dialog).queryByRole("button", { name: "Cargar más" }),
    ).toBeNull();
  });

  it("renders compact rows with icon actions on small screens", async () => {
    stubMatchMedia("(max-width:599.95px)");
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const row = (await within(dialog).findAllByTestId("manage-row"))[0]!;

    // Compact actions are icon buttons — they carry no visible text.
    const viewButton = within(row).getByRole("button", { name: "Ver imagen" });
    const deleteButton = within(row).getByRole("button", {
      name: "Eliminar medio",
    });
    expect(viewButton.textContent).toBe("");
    expect(deleteButton.textContent).toBe("");

    // The row still shows filename, linked chip, status and expiry.
    expect(within(row).getByText(/boleta\.jpg/)).toBeTruthy();
    expect(
      within(row).getByText("Vinculado a un movimiento"),
    ).toBeTruthy();
    expect(within(row).getByText("Confirmado")).toBeTruthy();
    expect(within(row).getByText(/Vence:/)).toBeTruthy();
  });
});

describe("media retention (receipt-retention-30d T5, S3+S5)", () => {
  it("shows the localized media expiry of each scan", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked, unlinked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const rows = await within(dialog).findAllByTestId("manage-row");
    expect(within(rows[0]!).getByText(/Vence: \d{2}\/11\/2026/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/Vence: \d{2}\/11\/2026/)).toBeTruthy();
  });

  it("deletes the media after inline confirmation and updates the row", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
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

    // The row switches to the deleted state: view and delete affordances
    // gone, linked-movement chip intact (CA-012).
    const updated = (await within(dialog).findAllByTestId("manage-row"))[0]!;
    expect(await within(updated).findByText("Medio eliminado")).toBeTruthy();
    expect(
      within(updated).queryByRole("button", { name: "Ver imagen" }),
    ).toBeNull();
    expect(
      within(updated).queryByRole("button", { name: "Eliminar medio" }),
    ).toBeNull();
    expect(
      within(updated).getByText("Vinculado a un movimiento"),
    ).toBeTruthy();
  });

  it("renders the deleted state when mediaDeletedAt is already set", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([mediaGone]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    const row = (await within(dialog).findAllByTestId("manage-row"))[0]!;
    expect(within(row).getByText("Medio eliminado")).toBeTruthy();
    expect(
      within(row).queryByRole("button", { name: "Ver imagen" }),
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
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
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
      within(stillLive).getByRole("button", { name: "Ver imagen" }),
    ).toBeTruthy();
    expect(within(stillLive).getByText(/Vence:/)).toBeTruthy();
  });
});

describe("bulk media purge (receipt-retention-30d T7, S6)", () => {
  it("offers the three retention periods in the purge menu", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    await within(dialog).findByText(/boleta\.jpg/);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Depurar medios" }),
    );

    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "más de 30 días" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "más de 15 días" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "más de 1 semana" }),
    ).toBeTruthy();
    // Choosing nothing fires nothing.
    expect(purgeReceiptMedia).not.toHaveBeenCalled();
  });

  it("purges only after confirming, sends the chosen period and refreshes", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(purgeReceiptMedia).mockResolvedValue({ deleted: 2 });

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    await within(dialog).findByText(/boleta\.jpg/);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Depurar medios" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "más de 15 días" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: "Depurar medios de tickets",
    });
    // The copy names the chosen period and warns that only the stored
    // images go away — never the transactions (CA-012).
    expect(within(confirm).getByText(/más de 15 días/)).toBeTruthy();
    expect(purgeReceiptMedia).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirm).getByRole("button", { name: "Depurar" }),
    );

    await waitFor(() =>
      expect(purgeReceiptMedia).toHaveBeenCalledWith(15),
    );

    // Localized result + the list refetches so purged scans disappear.
    expect(
      await within(dialog).findByText("2 medios eliminados"),
    ).toBeTruthy();
    await waitFor(() => expect(listReceipts).toHaveBeenCalledTimes(2));
  });

  it("surfaces the API error inside the confirm dialog", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));
    vi.mocked(purgeReceiptMedia).mockRejectedValue(new Error("boom"));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    await within(dialog).findByText(/boleta\.jpg/);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Depurar medios" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "más de 30 días" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: "Depurar medios de tickets",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Depurar" }),
    );

    await waitFor(() =>
      expect(purgeReceiptMedia).toHaveBeenCalledWith(30),
    );
    expect(
      await within(confirm).findByText(
        "No se pudo completar la operación. Intentá de nuevo.",
      ),
    ).toBeTruthy();
    // No success feedback and no extra fetch while it failed.
    expect(
      within(dialog).queryByText(/medios eliminados/),
    ).toBeNull();
    expect(listReceipts).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirm is cancelled", async () => {
    vi.mocked(listReceipts).mockResolvedValue(page([linked]));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Tickets cargados",
    });
    await within(dialog).findByText(/boleta\.jpg/);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Depurar medios" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "más de 1 semana" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: "Depurar medios de tickets",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Cancelar" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Depurar medios de tickets",
        }),
      ).toBeNull(),
    );
    expect(purgeReceiptMedia).not.toHaveBeenCalled();
    expect(listReceipts).toHaveBeenCalledTimes(1);
  });
});
