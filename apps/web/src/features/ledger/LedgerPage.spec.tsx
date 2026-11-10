// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { ThemeModeProvider } from "../../theme-mode";
import { fetchBalance, listTransactions, updateWorkspace } from "./api";
import { LedgerPage, TRANSACTIONS_PAGE_SIZE } from "./LedgerPage";
import {
  listPendingTransactions,
  type PendingTransaction,
} from "./offline/queue";
import type { TransactionView } from "./types";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    listTransactions: vi.fn(),
    fetchBalance: vi.fn(async () => []),
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

vi.mock("./offline/create-or-queue", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./offline/create-or-queue")>();
  return {
    createTransactionOrQueue: vi.fn(),
    // Real converter: pending rows must render with pendingSync + id
    // "pending:<key>" for the badge/chip assertions below.
    toPendingView: original.toPendingView,
  };
});

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
  it("renders the aggregate from the dedicated balance endpoint (T24)", async () => {
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
    vi.mocked(fetchBalance).mockResolvedValue([
      {
        currency: "PEN",
        initialBalance: "1000.00",
        income: "100.00",
        expenses: "25.00",
        net: "75.00",
        balance: "1075.00",
      },
    ]);
    vi.mocked(listTransactions).mockResolvedValue([]);

    const { container } = renderPage();

    await waitFor(() => {
      const pen = container.querySelector('[data-currency="PEN"]');
      expect(pen?.textContent).toContain("1,075.00");
      expect(pen?.textContent).toContain("Saldo actual");
    });
    expect(fetchBalance).toHaveBeenCalled();
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
    const cuentasDialog = await screen.findByRole("dialog", {
      name: "Cuentas",
    });

    // MUI closes on Escape only when the keydown targets the modal root.
    // `document.querySelector(".MuiModal-root")` is ambiguous — the
    // Gestión Menu renders in its own Modal and can still be unmounting,
    // so the first .MuiModal-root may be the menu's, not the dialog's
    // (the real source of this test's flake). Target the modal root
    // that actually contains this dialog.
    fireEvent.keyDown(
      cuentasDialog.closest(".MuiModal-root") ?? cuentasDialog,
      { key: "Escape" },
    );
    // Assert removal with headroom: the exit transition + portal unmount
    // can exceed waitFor's default 1 s under full-suite load.
    await waitForElementToBeRemoved(cuentasDialog, { timeout: 3_000 });

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

describe("LedgerPage pending sync (T7)", () => {
  const pendingItem: PendingTransaction = {
    idempotencyKey: "pending-key-1",
    input: {
      type: "expense",
      amount: "15.00",
      currency: "PEN",
      businessDate: "2026-10-05",
      timezone: "UTC",
      concept: "almuerzo pendiente",
      accountId: "acc-1",
      categoryId: null,
      idempotencyKey: "pending-key-1",
    },
    enqueuedAt: "2026-10-05T10:00:00.000Z",
    attempts: 0,
    lastError: null,
    ownerSubject: "user-a",
  };

  it("shows the pending count badge and marks queued rows", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listPendingTransactions).mockResolvedValue([pendingItem]);

    renderPage();

    expect(
      await screen.findByText("1 pendiente(s) de sincronizar"),
    ).toBeTruthy();
    expect(await screen.findByText("almuerzo pendiente")).toBeTruthy();
    expect(
      screen.getAllByText("Pendiente de sincronización").length,
    ).toBeGreaterThan(0);
  });

  it("hides the badge when the outbox is empty", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listPendingTransactions).mockResolvedValue([]);

    renderPage();

    // Wait until both queries settled (empty-state row + pending fetch done).
    expect(await screen.findByText("Todavía no hay movimientos.")).toBeTruthy();
    await waitFor(() => {
      expect(listPendingTransactions).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/pendiente\(s\) de sincronizar/)).toBeNull();
    expect(screen.queryByText("Pendiente de sincronización")).toBeNull();
  });
});

describe("LedgerPage list error surface", () => {
  it("shows the load error when transactions fail to fetch", async () => {
    vi.mocked(listTransactions).mockRejectedValue(new Error("boom"));

    renderPage();

    expect(
      await screen.findByText("No se pudieron cargar los movimientos."),
    ).toBeTruthy();
  });
});

describe("LedgerPage accounts management (T25)", () => {
  it("passes archived accounts to the Cuentas dialog so they can be restored", async () => {
    const { listAccounts } = await import("./api");
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listAccounts).mockResolvedValue([
      {
        id: "acc-active",
        workspaceId: "ws-1",
        name: "BCP Soles",
        currency: "PEN",
        kind: "bank",
        initialBalance: "0.00",
        archivedAt: null,
      },
      {
        id: "acc-archived",
        workspaceId: "ws-1",
        name: "Caja vieja",
        currency: "PEN",
        kind: "cash",
        initialBalance: "0.00",
        archivedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Gestión" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cuentas" }));

    const dialog = await screen.findByRole("dialog", { name: "Cuentas" });
    await waitFor(() => {
      expect(dialog.querySelector('[data-part="archived-accounts"]')).toBeTruthy();
      expect(within(dialog).getByText("Caja vieja")).toBeTruthy();
      expect(within(dialog).getByText("Archivadas")).toBeTruthy();
    });
  });
});
