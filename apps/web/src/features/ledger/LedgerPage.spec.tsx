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
import { ThemeModeProvider } from "../../theme-mode";
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
    listCurrencies: vi.fn(async () => [
      {
        id: "cur-pen",
        workspaceId: "ws-1",
        code: "PEN",
        nameEn: "Peruvian Sol",
        nameEs: "Sol peruano",
        minorUnitExponent: 2,
        archivedAt: null,
      },
      {
        id: "cur-usd",
        workspaceId: "ws-1",
        code: "USD",
        nameEn: "US Dollar",
        nameEs: "Dólar estadounidense",
        minorUnitExponent: 2,
        archivedAt: null,
      },
    ]),
    listCurrencyCatalog: vi.fn(async () => []),
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
    createTransaction: vi.fn(),
    reviseTransaction: vi.fn(),
    voidTransaction: vi.fn(),
    createAccount: vi.fn(),
    reviseAccount: vi.fn(),
    archiveAccount: vi.fn(),
    createCategory: vi.fn(),
    reviseCategory: vi.fn(),
    archiveCategory: vi.fn(),
    addCurrency: vi.fn(),
    reviseCurrency: vi.fn(),
    archiveCurrency: vi.fn(),
    listTransactionRevisions: vi.fn(async () => []),
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

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList => ({
      // only layout breakpoints match — OS-level queries like
      // prefers-color-scheme stay false so the theme resolves "light"
      matches: query.includes("min-width") ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}

function makeTx(id: string, partial: Partial<TransactionView> = {}): TransactionView {
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
    destinationAccountId: null,
    categoryId: null,
    status: "confirmed",
    origin: "manual",
    confirmedAt: "2026-10-01T00:00:00.000Z",
    revisionCount: 0,
    ...partial,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <LedgerPage />
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia(true); // desktop by default
});

afterEach(cleanup);

describe("LedgerPage pagination (RF-013)", () => {
  it("requests the first page with limit and offset", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: TRANSACTIONS_PAGE_SIZE,
          offset: 0,
        }),
      );
    });
  });

  it("offers 'Cargar más' only when the last page is full, and appends the next page", async () => {
    const firstPage = Array.from(
      { length: TRANSACTIONS_PAGE_SIZE },
      (_, index) => makeTx(`tx-${index}`),
    );
    vi.mocked(listTransactions).mockImplementation(async (filters) => {
      if (filters?.limit === undefined) return []; // balance query
      return filters.offset === 0 ? firstPage : [makeTx("tx-extra")];
    });

    renderPage();

    const loadMore = await screen.findByRole("button", {
      name: "Cargar más",
    });
    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: TRANSACTIONS_PAGE_SIZE,
          offset: TRANSACTIONS_PAGE_SIZE,
        }),
      );
    });
    expect(await screen.findByText("concepto tx-extra")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cargar más" }),
    ).toBeNull();
  });
});

describe("LedgerPage default period (S12-5)", () => {
  it("filters the list to the current month by default", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);

    renderPage();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const lastDay = pad(new Date(y, now.getMonth() + 1, 0).getDate());

    await waitFor(() => {
      expect(listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          from: `${y}-${m}-01`,
          to: `${y}-${m}-${lastDay}`,
        }),
      );
    });
  });
});

describe("LedgerPage balance block (S12-5)", () => {
  it("shows saldo actual = initial balances + income − expenses, transfers net 0", async () => {
    const { listAccounts } = await import("./api");
    vi.mocked(listAccounts).mockResolvedValue([
      {
        id: "acc-1",
        workspaceId: "ws-1",
        name: "BCP Soles",
        currency: "PEN",
        kind: "bank",
        initialBalance: "1000.00",
        archivedAt: null,
      },
    ]);
    vi.mocked(listTransactions).mockImplementation(async (filters) => {
      if (filters?.limit === undefined) {
        // balance query: unfiltered, all-time
        return [
          makeTx("t-in", { type: "income", amount: "100.00" }),
          makeTx("t-out", { type: "expense", amount: "25.00" }),
          makeTx("t-tr", {
            type: "transfer",
            amount: "999.00",
            destinationAccountId: "acc-2",
          }),
        ];
      }
      return [];
    });

    const { container } = renderPage();

    await waitFor(() => {
      const pen = container.querySelector('[data-currency="PEN"]');
      expect(pen?.textContent).toContain("1,075.00");
      expect(pen?.textContent).toContain("Saldo actual");
    });
  });
});

describe("LedgerPage top bar actions (S12-1)", () => {
  it("opens the movement type chooser and then the form for the picked type", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Nuevo movimiento" }),
    );

    const chooser = await screen.findByRole("dialog", {
      name: "Nuevo movimiento",
    });
    fireEvent.click(within(chooser).getByText("Gasto"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Guardar movimiento" }),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("combobox", { name: "Tipo" }).textContent,
    ).toBe("Gasto");
  });

  it("offers ingreso, gasto and transferencia in the chooser", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Nuevo movimiento" }),
    );

    const chooser = await screen.findByRole("dialog", {
      name: "Nuevo movimiento",
    });
    for (const label of ["Ingreso", "Gasto", "Transferencia"]) {
      expect(within(chooser).getByText(label)).toBeTruthy();
    }
  });

  it("opens the Gestión menu and its management dialogs", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Gestión" }));

    fireEvent.click(await screen.findByRole("menuitem", { name: "Cuentas" }));
    expect(
      await screen.findByRole("dialog", { name: "Cuentas" }),
    ).toBeTruthy();

    // MUI closes on Escape only when the keydown targets the modal root
    fireEvent.keyDown(
      document.querySelector(".MuiModal-root") ?? document.body,
      { key: "Escape" },
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Cuentas" })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Gestión" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Categorías" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Categorías" }),
    ).toBeTruthy();
  });
});

describe("LedgerPage workspace preferences (RF-003)", () => {
  it("sends the timezone patch from the Preferences dialog", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Gestión" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Preferencias" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Preferencias",
    });
    fireEvent.mouseDown(
      within(dialog).getByRole("combobox", { name: "Zona horaria" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "America/Bogota" }),
    );
    // T19: preferences are a draft — nothing is sent until Guardar.
    expect(vi.mocked(updateWorkspace)).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Guardar" }),
    );

    await waitFor(() => {
      expect(vi.mocked(updateWorkspace).mock.calls[0]?.[0]).toEqual({
        timezone: "America/Bogota",
      });
    });
  });
});

describe("LedgerPage currencies dialog load errors (T19)", () => {
  it("surfaces query failures inside the Monedas dialog", async () => {
    const { listCurrencies, ApiError } = await import("./api");
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listCurrencies).mockRejectedValue(
      new ApiError("HTTP_404", "Not found", 404),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Gestión" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Monedas" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Monedas" });
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "No se pudo completar la operación",
      );
    });
  });
});

describe("LedgerPage theme toggle (S12-7)", () => {
  it("persists tfm-theme-mode when toggling dark/light", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    renderPage();

    const toggle = await screen.findByRole("button", {
      name: "Cambiar a modo oscuro",
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem("tfm-theme-mode")).toBe("dark");
    });
    expect(
      await screen.findByRole("button", { name: "Cambiar a modo claro" }),
    ).toBeTruthy();
  });
});

describe("LedgerPage responsive layout (S12-6)", () => {
  it("renders sidebar + dense table on desktop (≥960px)", async () => {
    mockMatchMedia(true);
    vi.mocked(listTransactions).mockResolvedValue([makeTx("tx-1")]);

    renderPage();

    expect(await screen.findByRole("complementary")).toBeTruthy();
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(await screen.findByText("concepto tx-1")).toBeTruthy();
  });

  it("renders day cards, pill tabbar and FAB on mobile (<960px)", async () => {
    mockMatchMedia(false);
    vi.mocked(listTransactions).mockResolvedValue([makeTx("tx-1")]);

    const { container } = renderPage();

    expect(await screen.findByText("concepto tx-1")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      container.querySelectorAll("[data-day-group]").length,
    ).toBeGreaterThan(0);
    // topbar button + FAB both offer "Nuevo movimiento"
    expect(
      screen.getAllByRole("button", { name: "Nuevo movimiento" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeTruthy();
  });
});
