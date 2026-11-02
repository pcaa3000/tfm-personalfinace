// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { listTransactions, updateWorkspace } from "./api";
import { LedgerPage, TRANSACTIONS_PAGE_SIZE } from "./LedgerPage";
import type { TransactionView } from "./types";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    listTransactions: vi.fn(),
    listAccounts: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getWorkspace: vi.fn(async () => ({
      workspaceId: "ws-1",
      locale: "es-PE",
      timezone: "UTC",
      defaultCurrency: "PEN",
    })),
    updateWorkspace: vi.fn(async () => ({
      workspaceId: "ws-1",
      locale: "es-PE",
      timezone: "UTC",
      defaultCurrency: "PEN",
    })),
  };
});

vi.mock("./offline/queue", () => ({
  listPendingTransactions: vi.fn(async () => []),
}));

vi.mock("./offline/use-pending-sync", () => ({
  PENDING_QUERY_KEY: ["pending-transactions"],
  usePendingSync: () => {},
}));

vi.mock("./offline/create-or-queue", () => ({
  createTransactionOrQueue: vi.fn(),
  toPendingView: (view: TransactionView) => view,
}));

function makeTx(id: string): TransactionView {
  return {
    id,
    workspaceId: "ws-1",
    type: "expense",
    amount: "10.00",
    currency: "PEN",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: `concepto ${id}`,
    accountId: "acc-1",
    categoryId: null,
    status: "confirmed",
    origin: "manual",
    confirmedAt: "2026-10-01T00:00:00.000Z",
    revisionCount: 0,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LedgerPage />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("LedgerPage pagination (RF-013)", () => {
  it("requests the first page with limit and offset", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(listTransactions).toHaveBeenCalledWith({
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: 0,
      });
    });
  });

  it("offers 'Cargar más' only when the last page is full, and appends the next page", async () => {
    const firstPage = Array.from(
      { length: TRANSACTIONS_PAGE_SIZE },
      (_, index) => makeTx(`tx-${index}`),
    );
    vi.mocked(listTransactions).mockImplementation(async (filters = {}) =>
      filters.offset === 0 ? firstPage : [makeTx("tx-extra")],
    );

    renderPage();

    const loadMore = await screen.findByRole("button", {
      name: "Cargar más",
    });
    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(listTransactions).toHaveBeenLastCalledWith({
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: TRANSACTIONS_PAGE_SIZE,
      });
    });
    expect(await screen.findByText("concepto tx-extra")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cargar más" }),
    ).toBeNull();
  });
});

describe("LedgerPage workspace preferences (RF-003)", () => {
  it("sends the timezone patch when the preference changes", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);

    renderPage();

    const timezoneSelect = await screen.findByRole("combobox", {
      name: "Zona horaria",
    });
    fireEvent.mouseDown(timezoneSelect);
    fireEvent.click(
      await screen.findByRole("option", { name: "America/Bogota" }),
    );

    await waitFor(() => {
      expect(vi.mocked(updateWorkspace).mock.calls[0]?.[0]).toEqual({
        timezone: "America/Bogota",
      });
    });
  });
});
