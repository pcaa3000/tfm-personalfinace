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
import { ThemeModeProvider } from "../../theme-mode";
import type {
  AvoidableExpensesView,
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
    // Shared-chrome queries (T16): the movement dialog and the
    // management dialogs read these; empty data is enough.
    listAccounts: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listCurrencyCatalog: vi.fn(async () => []),
  };
});

const mocks = vi.hoisted(() => ({
  fetchCashFlowReport: vi.fn(),
  fetchExpensesByCategory: vi.fn(),
  fetchAvoidableExpenses: vi.fn(),
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



const avoidable: AvoidableExpensesView = {
  period: PERIOD,
  totalDiscretionary: "450.00",
  potentialSavings: "130.00",
  groups: [
    {
      detectors: ["ant", "recurring_charge"],
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
    {
      detectors: ["concentration"],
      groupKind: "merchant",
      key: "vuelos lima",
      label: "vuelos lima",
      operationCount: 1,
      total: "50.00",
      average: "50.00",
      percentOfDiscretionary: 11.11,
      confidence: "high",
      transactionIds: ["t6"],
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
  avoidable: AvoidableExpensesView;
  savings: MonthlySavingsView;
}

function mockReports(overrides: Partial<ReportViews> = {}) {
  const data: ReportViews = {
    cashFlow,
    categories,
    avoidable,
    savings,
    ...overrides,
  };
  mocks.fetchCashFlowReport.mockResolvedValue(data.cashFlow);
  mocks.fetchExpensesByCategory.mockResolvedValue(data.categories);
  mocks.fetchAvoidableExpenses.mockResolvedValue(data.avoidable);
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

/** Simulate a real viewport width against min/max-width media queries. */
function mockViewportWidth(width: number) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList => {
      const min = /\(min-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
      const max = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
      const matches =
        query.includes("width") &&
        (min === null || width >= Number(min[1])) &&
        (max === null || width <= Number(max[1]));
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  );
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
    expect(screen.getByText("Gastos evitables")).toBeTruthy();
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

  it("shows the potential monthly savings and a detector chip per group", async () => {
    mockReports();
    renderPage();

    // T12 (S11): the headline figure is the sum of every admitted
    // group's total — what the user could avoid.
    expect(
      await screen.findByText(/Ahorro potencial mensual: 130,00 PEN/),
    ).toBeTruthy();
    // Detectors render as translated chips on each group row.
    expect(screen.getByText("Hormiga")).toBeTruthy();
    expect(screen.getByText("Recurrente")).toBeTruthy();
    expect(screen.getByText("Concentración")).toBeTruthy();
  });

  it("shows the empty state when a section has no rows", async () => {
    mockReports({
      categories: { ...categories, categories: [], totalExpenses: "0.00" },
      avoidable: { ...avoidable, groups: [] },
    });
    renderPage();

    expect(
      await screen.findByText("Sin gastos confirmados en el período."),
    ).toBeTruthy();
    expect(
      screen.getByText("Sin gastos evitables detectados en el período."),
    ).toBeTruthy();
  });

  it("shows the savings figures and the observed rate", async () => {
    mockReports();
    renderPage();

    expect(await screen.findByText("Tasa observada")).toBeTruthy();
    // S13: the rate also appears in the summary strip and section header.
    expect(screen.getAllByText(/75\s?%/).length).toBeGreaterThan(0);
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

describe("ReportsPage executive summary + collapsible sections (reports-monthly T14, S13)", () => {
  const discretionaryCategory = {
    categoryId: "cat-cafes",
    key: "cafes",
    label: "Cafés",
    nature: "discretionary",
    total: "450.00",
    percentOfExpenses: 36,
    transactionCount: 20,
  };

  it("renders the four KPIs computed from the already-fetched views", async () => {
    mockReports({
      categories: {
        ...categories,
        categories: [...categories.categories, discretionaryCategory],
      },
    });
    renderPage();

    const summary = await screen.findByRole("region", {
      name: "Resumen ejecutivo",
    });

    // Observed savings: saved amount + observed-rate hint.
    expect(within(summary).getByText("Ahorro observado")).toBeTruthy();
    expect(
      await within(summary).findByText(/3750,00\s?PEN/),
    ).toBeTruthy();
    expect(within(summary).getByText(/Tasa observada: 75\s?%/)).toBeTruthy();

    // Avoidable expenses: potential savings + group count hint.
    expect(within(summary).getByText("Ahorro potencial")).toBeTruthy();
    expect(within(summary).getByText(/130,00\s?PEN/)).toBeTruthy();
    expect(within(summary).getByText("2 grupos")).toBeTruthy();

    // Cash flow: sum of net flows across accounts (3500 + (-50)).
    expect(within(summary).getByText("Flujo de caja")).toBeTruthy();
    expect(within(summary).getByText(/3450,00\s?PEN/)).toBeTruthy();
    expect(within(summary).getByText("2 cuentas")).toBeTruthy();

    // Top discretionary category.
    expect(within(summary).getByText("Top categoría")).toBeTruthy();
    expect(within(summary).getByText("Cafés")).toBeTruthy();
    // Anchored: "3450,00 PEN" (cash flow) would also match a loose 450 regex.
    expect(within(summary).getByText(/^450,00\s?PEN$/)).toBeTruthy();
  });

  it("collapses the four sections by default, keeping a summary line in the header", async () => {
    mockReports({
      avoidable: { ...avoidable, groups: [], potentialSavings: "0.00" },
    });
    renderPage();

    const cashFlowSection = await screen.findByRole("region", {
      name: "Flujo de caja por cuenta",
    });
    const categoriesSection = screen.getByRole("region", {
      name: "Gastos por categoría",
    });
    const avoidableSection = screen.getByRole("region", {
      name: "Gastos evitables",
    });
    const savingsSection = screen.getByRole("region", {
      name: "Ahorro del mes",
    });

    const header = (section: HTMLElement, name: RegExp) =>
      within(section).getByRole("button", { name });

    expect(
      header(cashFlowSection, /Flujo de caja por cuenta/).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    expect(
      header(categoriesSection, /Gastos por categoría/).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    expect(
      header(avoidableSection, /Gastos evitables/).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    expect(
      header(savingsSection, /Ahorro del mes/).getAttribute("aria-expanded"),
    ).toBe("false");

    // The collapsed header still surfaces the section's headline figures.
    expect(
      await within(cashFlowSection).findByText(/3450,00\s?PEN · 2 cuentas/),
    ).toBeTruthy();
    expect(
      within(categoriesSection).getByText(/1250,00\s?PEN · 1 categoría/),
    ).toBeTruthy();
    expect(
      within(avoidableSection).getByText(/0,00\s?PEN · 0 grupos/),
    ).toBeTruthy();
    expect(
      within(savingsSection).getByText(/3750,00\s?PEN · 75\s?%/),
    ).toBeTruthy();
  });

  it("auto-opens the avoidable section once it detects groups", async () => {
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Gastos evitables",
    });
    const header = within(section).getByRole("button", {
      name: /Gastos evitables/,
    });
    await waitFor(() =>
      expect(header.getAttribute("aria-expanded")).toBe("true"),
    );
  });

  it("keeps the avoidable section collapsed when it detects no groups", async () => {
    mockReports({
      avoidable: { ...avoidable, groups: [], potentialSavings: "0.00" },
    });
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Gastos evitables",
    });
    // Wait for the resolved data (the header summary is data-driven).
    await within(section).findByText(/0 grupos/);
    const header = within(section).getByRole("button", {
      name: /Gastos evitables/,
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles a section open and closed when its header is clicked", async () => {
    mockReports();
    renderPage();

    const categoriesSection = await screen.findByRole("region", {
      name: "Gastos por categoría",
    });
    const categoriesHeader = within(categoriesSection).getByRole("button", {
      name: /Gastos por categoría/,
    });
    expect(categoriesHeader.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(categoriesHeader);
    expect(categoriesHeader.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(categoriesHeader);
    expect(categoriesHeader.getAttribute("aria-expanded")).toBe("false");

    // The user can also collapse an auto-opened section.
    const avoidableSection = await screen.findByRole("region", {
      name: "Gastos evitables",
    });
    const avoidableHeader = within(avoidableSection).getByRole("button", {
      name: /Gastos evitables/,
    });
    await waitFor(() =>
      expect(avoidableHeader.getAttribute("aria-expanded")).toBe("true"),
    );
    fireEvent.click(avoidableHeader);
    expect(avoidableHeader.getAttribute("aria-expanded")).toBe("false");
  });

  it("resets manual toggles when the selected period changes", async () => {
    mockReports();
    renderPage();

    const categoriesSection = await screen.findByRole("region", {
      name: "Gastos por categoría",
    });
    const categoriesHeader = within(categoriesSection).getByRole("button", {
      name: /Gastos por categoría/,
    });
    fireEvent.click(categoriesHeader);
    expect(categoriesHeader.getAttribute("aria-expanded")).toBe("true");

    // Selecting another month returns every section to its auto
    // default (collapsed) — a hidden section must not stay hidden.
    const current = new Date();
    const previous = current.getMonth() === 0 ? 12 : current.getMonth();
    const previousYear =
      current.getMonth() === 0
        ? current.getFullYear() - 1
        : current.getFullYear();
    await selectPeriod(previousYear, previous);
    await waitFor(() =>
      expect(categoriesHeader.getAttribute("aria-expanded")).toBe("false"),
    );
  });
});

describe("ReportsPage mobile layout (reports-monthly T13, S12)", () => {
  beforeEach(() => mockViewportWidth(390));

  it("stacks the cash-flow table, keeping every figure labeled", async () => {
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Flujo de caja por cuenta",
    });
    // Identifying field + secondary kind caption survive.
    expect(await within(section).findByText("BCP Soles")).toBeTruthy();
    expect(section.querySelector("table")).toBeNull();
    expect(
      section.querySelector('[data-part="report-stacked-rows"]'),
    ).toBeTruthy();
    expect(within(section).getByText("bank")).toBeTruthy();
    expect(within(section).getByText("Sin cuenta")).toBeTruthy();
    // Every column of the wide table stays visible, labeled, per row.
    expect(within(section).getAllByText("Ingresos")).toHaveLength(2);
    expect(within(section).getAllByText("Transf. entrantes")).toHaveLength(2);
    expect(within(section).getAllByText("Flujo neto")).toHaveLength(2);
    expect(within(section).getByText(/3500,00\s?PEN/)).toBeTruthy();
    expect(within(section).getByText(/-50,00\s?PEN/)).toBeTruthy();
  });

  it("stacks the category table with nature, total, share and count", async () => {
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Gastos por categoría",
    });
    expect(await within(section).findByText("Comida")).toBeTruthy();
    expect(section.querySelector("table")).toBeNull();
    expect(
      section.querySelector('[data-part="report-stacked-rows"]'),
    ).toBeTruthy();
    expect(within(section).getByText("Esencial")).toBeTruthy();
    expect(
      within(section).getAllByText(/800,00\s?PEN/).length,
    ).toBeGreaterThan(0);
    expect(within(section).getByText("64%")).toBeTruthy();
    expect(within(section).getByText("12")).toBeTruthy();
    // The nature subtotal chips stay on mobile too.
    expect(within(section).getByText(/Esencial: 800,00\s?PEN/)).toBeTruthy();
  });

  it("stacks the avoidable-expenses table with detectors and figures", async () => {
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Gastos evitables",
    });
    expect(await within(section).findByText("starbucks")).toBeTruthy();
    expect(section.querySelector("table")).toBeNull();
    expect(
      section.querySelector('[data-part="report-stacked-rows"]'),
    ).toBeTruthy();
    // Detector + confidence chips stay on each stacked row.
    expect(within(section).getByText("Hormiga")).toBeTruthy();
    expect(within(section).getByText("Recurrente")).toBeTruthy();
    expect(within(section).getByText("Concentración")).toBeTruthy();
    expect(within(section).getAllByText("Alta")).toHaveLength(2);
    // Key figures: total, average, % discretionary, operations.
    expect(within(section).getByText(/80,00\s?PEN/)).toBeTruthy();
    expect(within(section).getByText(/16,00\s?PEN/)).toBeTruthy();
    expect(within(section).getByText("17,78%")).toBeTruthy();
    expect(within(section).getByText("5")).toBeTruthy();
  });

  it("keeps the savings figures readable as stacked stat cards", async () => {
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Ahorro del mes",
    });
    expect(await within(section).findByText("Tasa observada")).toBeTruthy();
    expect(section.querySelector("table")).toBeNull();
    expect(within(section).getByText("Ahorro")).toBeTruthy();
    // S13: the collapsed header summary repeats these figures.
    expect(
      within(section).getAllByText(/3750,00\s?PEN/).length,
    ).toBeGreaterThan(0);
    expect(within(section).getAllByText(/75\s?%/).length).toBeGreaterThan(0);
  });

  it("keeps the wide tables on the desktop breakpoint", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    const section = await screen.findByRole("region", {
      name: "Flujo de caja por cuenta",
    });
    expect(await within(section).findByText("BCP Soles")).toBeTruthy();
    expect(section.querySelector("table")).toBeTruthy();
    expect(
      section.querySelector('[data-part="report-stacked-rows"]'),
    ).toBeNull();
  });
});

describe("ReportsPage shared chrome (reports-monthly T16, S15)", () => {
  it("navigates back to the ledger list from the mobile bottom nav", async () => {
    mockViewportWidth(390);
    mockReports();
    renderPage();

    const nav = await screen.findByRole("navigation", {
      name: "Navegación principal",
    });
    fireEvent.click(
      within(nav).getByRole("button", { name: "Movimientos" }),
    );
    expect(window.location.hash).toBe("#/");
  });

  it("opens the shared new-movement dialog from the mobile nav FAB", async () => {
    mockViewportWidth(390);
    mockReports();
    const { container } = renderPage();

    const fab = container.querySelector(".MuiFab-root");
    expect(fab).toBeTruthy();
    fireEvent.click(fab as Element);

    // The shared NewMovementDialog opens on its type-picker step.
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Mover importe entre cuentas de la misma moneda"),
    ).toBeTruthy();
  });

  it("shows the reports crumb in the shared desktop topbar", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    // The crumb names the active page, not the ledger panel.
    await screen.findByText(/·\s*Reportes/);
  });

  it("opens the shared new-movement dialog from the desktop topbar action", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Nuevo movimiento" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Mover importe entre cuentas de la misma moneda"),
    ).toBeTruthy();
  });

  it("wires the sidebar Gestión group to the shared management dialogs", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    const aside = await screen.findByRole("complementary");
    fireEvent.click(
      within(aside).getByRole("button", { name: "Cuentas" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Cuentas")).toBeTruthy();
  });

  it("navigates back to the ledger list from the desktop sidebar", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    const aside = await screen.findByRole("complementary");
    fireEvent.click(
      within(aside).getByRole("button", { name: "Movimientos" }),
    );
    expect(window.location.hash).toBe("#/");
  });

  it("renders a single theme switcher — the shared TopBar carries it", async () => {
    mockViewportWidth(1400);
    mockReports();
    renderPage();

    await screen.findByText("Flujo de caja por cuenta");
    expect(
      screen.getAllByRole("button", { name: /Cambiar a modo/ }),
    ).toHaveLength(1);
  });
});
