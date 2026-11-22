// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { ThemeModeProvider } from "../../theme-mode";
import type {
  AntExpensesView,
  CashFlowReportView,
  ExpensesByCategoryView,
  MonthlySavingsView,
  ReportPeriod,
} from "./api";
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
