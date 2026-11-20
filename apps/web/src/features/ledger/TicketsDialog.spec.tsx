// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { listReceipts } from "./api";
import { TicketsDialog } from "./TicketsDialog";
import type { ReceiptListItemView } from "./receipt-draft";

vi.mock("./api", () => ({
  listReceipts: vi.fn(),
}));

const linked: ReceiptListItemView = {
  id: "rc-1",
  status: "confirmed",
  originalFilename: "boleta.jpg",
  fileMimeType: "image/jpeg",
  createdAt: "2026-10-05T15:30:00.000Z",
  transactionId: "tx-9",
};

const unlinked: ReceiptListItemView = {
  id: "rc-2",
  status: "draft_ready",
  originalFilename: "ticket.png",
  fileMimeType: "image/png",
  createdAt: "2026-10-04T10:00:00.000Z",
  transactionId: null,
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
    expect(first.getByText(/2026/)).toBeTruthy();
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
