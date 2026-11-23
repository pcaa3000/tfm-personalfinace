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
import { ThemeModeProvider } from "../../theme-mode";
import type {
  AntExpensesView,
  CashFlowReportView,
  ExpensesByCategoryView,
  MonthlySavingsView,
  PeriodCloseView,
  ReportPeriod,
} from "./api";
import { monthName } from "./format";
import { ReportsPage } from "./ReportsPage";

vi.mock("../ledger/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../ledger/api")>();
  return {
    ...original,
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
    ]),
    getWorkspace: vi.fn(async () => ({
      workspaceId: "ws-1",
      timezone: "UTC",
      defaultCurrency: "PEN",
    })),
  };
});

const mocks = vi.hoisted(() => ({
  fetchCashFlowReport: vi.fn(),
  fetchExpensesByCategory: vi.fn(),
  fetchAntExpenses: vi.fn(),
  fetchMonthlySavings: vi.fn(),
  listPeriodCloses: vi.fn(),
  closePeriod: vi.fn(),
  fetchReportExport: vi.fn(),
}));

vi.mock("./api", () => mocks);

const PERIOD: ReportPeriod = {
  from: "2026-11-01",
  to: "2026-11-12",
  currency: "PEN",
  periodStatus: "provisional",
};

const CLOSED_PERIOD: ReportPeriod = { ...PERIOD, periodStatus: "closed" };

const cashFlow: CashFlowReportView = {
  period: PERIOD,
  accounts: [
    {
      accountId: "acc-1",
      name: "BCP Soles",
      kind: "bank",
      income: "5000.00",
      expense: "1200.00",
      transfersIn: "0.00",
      transfersOut: "300.00",
      netFlow: "3500.00",
    },
    {
      accountId: null,
      name: null,
      kind: null,
      income: "0.00",
      expense: "50.00",
      transfersIn: "0.00",
      transfersOut: "0.00",
      netFlow: "-50.00",
    },
  ],
};

const categories: ExpensesByCategoryView = {
  period: PERIOD,
  totalExpenses: "1250.00",
  natureTotals: {
    essential: "800.00",
    discretionary: "450.00",
    obligation: "0.00",
    uncategorized: "0.00",
  },
  categories: [
    {
      categoryId: "cat-food",
      key: "food",
      label: "Comida",
      nature: "essential",
      total: "800.00",
      percentOfExpenses: 64,
      transactionCount: 12,
    },
  ],
};

const ant: AntExpensesView = {
  period: PERIOD,
  totalDiscretionary: "450.00",
  groups: [
    {
      groupKind: "merchant",
      key: "starbucks",
      label: "starbucks",
      operationCount: 5,
      total: "80.00",
      average: "16.00",
      percentOfDiscretionary: 17.78,
      confidence: "high",
      transactionIds: ["t1", "t2", "t3", "t4", "t5"],
    },
  ],
};

const savings: MonthlySavingsView = {
  period: PERIOD,
  income: "5000.00",
  expense: "1250.00",
  saved: "3750.00",
  observedRate: "75.00",
  note: null,
  deficit: null,
};

interface ReportViews {
  cashFlow: CashFlowReportView;
  categories: ExpensesByCategoryView;
  ant: AntExpensesView;
  savings: MonthlySavingsView;
}

function mockReports(overrides: Partial<ReportViews> = {}) {
  const data: ReportViews = {
    cashFlow,
    categories,
    ant,
    savings,
    ...overrides,
  };
  mocks.fetchCashFlowReport.mockResolvedValue(data.cashFlow);
  mocks.fetchExpensesByCategory.mockResolvedValue(data.categories);
  mocks.fetchAntExpenses.mockResolvedValue(data.ant);
  mocks.fetchMonthlySavings.mockResolvedValue(data.savings);
  mocks.listPeriodCloses.mockResolvedValue([]);
}

/** A year+month guaranteed to be a fully finished UTC calendar month
 * (the workspace mock pins timezone "UTC"). */
function finishedYearMonth(): { year: number; month: number } {
  const previous = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1),
  );
  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
  };
}

function closeView(
  year: number,
  month: number,
  overrides: Partial<PeriodCloseView> = {},
): PeriodCloseView {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return {
    id: `close-${key}`,
    currency: "PEN",
    periodStart: `${key}-01`,
    periodEnd: `${key}-28`,
    timezone: "UTC",
    integrityDeclared: true,
    closedAt: "2026-11-05T10:00:00.000Z",
    invalidatedAt: null,
    supersededAt: null,
    stale: false,
    ...overrides,
  };
}

/** Drives the MUI month/year selects (portal-rendered options). */
async function selectPeriod(year: number, month: number) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Año" }));
  fireEvent.click(await screen.findByRole("option", { name: String(year) }));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Mes" }));
  fireEvent.click(
    await screen.findByRole("option", { name: monthName(month, "es") }),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ReportsPage />
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.clearAllMocks();
});

describe("ReportsPage (reports-monthly T7, S7, CA-013)", () => {
  it("renders the four report sections", async () => {
    mockReports();
    renderPage();

    expect(await screen.findByText("Flujo de caja por cuenta")).toBeTruthy();
    expect(screen.getByText("Gastos por categoría")).toBeTruthy();
    expect(screen.getByText("Gastos hormiga")).toBeTruthy();
    expect(screen.getByText("Ahorro del mes")).toBeTruthy();
  });

  it("shows the provisional badge and the per-account cash flow rows", async () => {
    mockReports();
    renderPage();

    expect((await screen.findAllByText("Provisional")).length).toBeGreaterThan(0);
    expect(screen.getByText("BCP Soles")).toBeTruthy();
    // The unassigned group renders its own label, not a blank cell.
    expect(screen.getByText("Sin cuenta")).toBeTruthy();
  });

  it("shows the closed badge for a closed period", async () => {
    mockReports({
      cashFlow: { ...cashFlow, period: CLOSED_PERIOD },
    });
    renderPage();

    expect(await screen.findAllByText("Cerrado")).not.toHaveLength(0);
  });

  it("shows the empty state when a section has no rows", async () => {
    mockReports({
      categories: { ...categories, categories: [], totalExpenses: "0.00" },
      ant: { ...ant, groups: [] },
    });
    renderPage();

    expect(
      await screen.findByText("Sin gastos confirmados en el período."),
    ).toBeTruthy();
    expect(
      screen.getByText("Sin gastos hormiga detectados en el período."),
    ).toBeTruthy();
  });

  it("shows the savings figures and the observed rate", async () => {
    mockReports();
    renderPage();

    expect(await screen.findByText("Tasa observada")).toBeTruthy();
    expect(screen.getByText(/75\s?%/)).toBeTruthy();
  });

  it("shows the deficit note with the deficit amount", async () => {
    mockReports({
      savings: {
        ...savings,
        income: "1000.00",
        expense: "1800.00",
        saved: "-800.00",
        observedRate: "0.00",
        note: "deficit",
        deficit: "800.00",
      },
    });
    renderPage();

    expect(await screen.findByText(/Déficit del período/)).toBeTruthy();
  });

  it("shows the no-income note when the period has no income", async () => {
    mockReports({
      savings: {
        ...savings,
        income: "0.00",
        saved: "-1250.00",
        observedRate: null,
        note: "no_income",
        deficit: null,
      },
    });
    renderPage();

    expect(await screen.findByText(/Sin ingresos confirmados/)).toBeTruthy();
  });

  it("offers a retry when a section fails to load", async () => {
    mockReports();
    mocks.fetchCashFlowReport.mockRejectedValue(new Error("boom"));
    renderPage();

    expect(await screen.findByText(/No se pudo cargar el reporte/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Reintentar" }).length).toBeGreaterThan(0);
  });
});

describe("ReportsPage close month (reports-monthly T9, S5)", () => {
  it("offers 'Cerrar mes' for a finished month without an active close", async () => {
    mockReports();
    renderPage();
    const { year, month } = finishedYearMonth();
    await selectPeriod(year, month);

    expect(
      await screen.findByRole("button", { name: "Cerrar mes" }),
    ).toBeTruthy();
  });

  it("never offers 'Cerrar mes' for the running month", async () => {
    mockReports();
    renderPage();

    await screen.findByText("Flujo de caja por cuenta");
    await waitFor(() =>
      expect(mocks.listPeriodCloses).toHaveBeenCalledWith("PEN"),
    );
    expect(screen.queryByRole("button", { name: "Cerrar mes" })).toBeNull();
  });

  it("hides 'Cerrar mes' when the finished month already has an active close", async () => {
    const { year, month } = finishedYearMonth();
    mockReports();
    mocks.listPeriodCloses.mockResolvedValue([closeView(year, month)]);
    renderPage();
    await selectPeriod(year, month);

    await screen.findByText("Flujo de caja por cuenta");
    await waitFor(() =>
      expect(mocks.listPeriodCloses).toHaveBeenCalledWith("PEN"),
    );
    expect(screen.queryByRole("button", { name: "Cerrar mes" })).toBeNull();
  });

  it("offers 'Cerrar mes' for a stale close — re-closing supersedes it (S5)", async () => {
    const { year, month } = finishedYearMonth();
    mockReports();
    mocks.listPeriodCloses.mockResolvedValue([
      closeView(year, month, {
        invalidatedAt: "2026-11-08T10:00:00.000Z",
        stale: true,
      }),
    ]);
    renderPage();
    await selectPeriod(year, month);

    expect(
      await screen.findByRole("button", { name: "Cerrar mes" }),
    ).toBeTruthy();
  });

  it("confirms the integrity declaration and refetches the sections", async () => {
    const { year, month } = finishedYearMonth();
    mockReports();
    mocks.closePeriod.mockResolvedValue(closeView(year, month));
    renderPage();
    await selectPeriod(year, month);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cerrar mes" }),
    );
    // The dialog states the integrity declaration in plain text (S5).
    expect(
      await screen.findByText(/declaras que todos los movimientos/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar cierre" }));

    // closePeriod always posts integrityConfirmed:true (see api.spec).
    await waitFor(() =>
      expect(mocks.closePeriod).toHaveBeenCalledWith("PEN", year, month),
    );
    // The 4 report queries + the closes query are invalidated → refetch.
    await waitFor(() => {
      expect(mocks.fetchCashFlowReport.mock.calls.length).toBeGreaterThan(1);
      expect(mocks.listPeriodCloses.mock.calls.length).toBeGreaterThan(1);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Confirmar cierre" }),
      ).toBeNull(),
    );
  });

  it("treats PERIOD_ALREADY_CLOSED as already closed and refetches", async () => {
    const { ApiError } = await import("../ledger/api");
    const { year, month } = finishedYearMonth();
    mockReports();
    mocks.closePeriod.mockRejectedValue(
      new ApiError("PERIOD_ALREADY_CLOSED", "already closed", 409),
    );
    renderPage();
    await selectPeriod(year, month);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cerrar mes" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar cierre" }),
    );

    await waitFor(() =>
      expect(mocks.closePeriod).toHaveBeenCalledWith("PEN", year, month),
    );
    // No error copy — the queries refetch into the "Cerrado" state.
    await waitFor(() =>
      expect(
        mocks.listPeriodCloses.mock.calls.length,
      ).toBeGreaterThan(1),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Confirmar cierre" }),
      ).toBeNull(),
    );
  });
});

describe("ReportsPage export (reports-monthly T10)", () => {
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: realCreateObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: realRevokeObjectURL,
      configurable: true,
      writable: true,
    });
  });

  function stubObjectURL() {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
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
    return { createObjectURL, revokeObjectURL };
  }

  async function enabledExportButton(name: string) {
    const button = await screen.findByRole("button", { name });
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    return button as HTMLButtonElement;
  }

  it("fetches the CSV export with the format param and triggers the anchor download", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { createObjectURL, revokeObjectURL } = stubObjectURL();
    mockReports();
    mocks.fetchReportExport.mockResolvedValue(new Blob(["csv-data"]));
    renderPage();

    const button = await enabledExportButton("CSV");
    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.fetchReportExport).toHaveBeenCalledWith(
        {
          currency: "PEN",
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
        },
        "csv",
      ),
    );
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });

  it("requests the Excel export with format=xlsx", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    stubObjectURL();
    mockReports();
    mocks.fetchReportExport.mockResolvedValue(new Blob(["xlsx-data"]));
    renderPage();

    fireEvent.click(await enabledExportButton("Excel (.xlsx)"));

    await waitFor(() =>
      expect(mocks.fetchReportExport).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "PEN" }),
        "xlsx",
      ),
    );
    clickSpy.mockRestore();
  });

  it("shows an error message when the export fails", async () => {
    stubObjectURL();
    mockReports();
    mocks.fetchReportExport.mockRejectedValue(new Error("boom"));
    renderPage();

    fireEvent.click(await enabledExportButton("CSV"));

    expect(
      await screen.findByText(/No se pudo descargar el reporte/),
    ).toBeTruthy();
  });
});
