import { describe, expect, it } from "vitest";

import type { ReportPeriod } from "../domain/report-period.js";
import type { AntExpensesView } from "./ant-expenses.view.js";
import type { CashFlowReportView } from "./cash-flow.view.js";
import type { ExpensesByCategoryView } from "./expenses-by-category.view.js";
import type { MonthlySavingsView } from "./monthly-savings.view.js";
import {
  reportExportTables,
  serializeReportCsv,
  type MonthlyReportBundle,
  type ReportExportMetadata,
} from "./report-export.serializer.js";

const PERIOD: ReportPeriod = {
  from: "2026-09-01",
  to: "2026-09-30",
  currency: "EUR",
  periodStatus: "provisional",
};

const METADATA: ReportExportMetadata = {
  timezone: "UTC",
  currency: "EUR",
  from: "2026-09-01",
  to: "2026-09-30",
  periodStatus: "provisional",
  generatedAt: "2026-10-01T12:00:00.000Z",
};

const CASH_FLOW: CashFlowReportView = {
  period: PERIOD,
  accounts: [
    {
      accountId: "acc-1",
      name: "Checking",
      kind: "bank",
      income: "100.00",
      expense: "40.50",
      transfersIn: "0.00",
      transfersOut: "38.00",
      netFlow: "21.50",
    },
    {
      accountId: null,
      name: null,
      kind: null,
      income: "0.00",
      expense: "15.25",
      transfersIn: "8.00",
      transfersOut: "0.00",
      netFlow: "-7.25",
    },
  ],
};

const EXPENSES: ExpensesByCategoryView = {
  period: PERIOD,
  totalExpenses: "400.00",
  natureTotals: {
    essential: "300.00",
    discretionary: "100.00",
    obligation: "0.00",
    uncategorized: "0.00",
  },
  categories: [
    {
      categoryId: "cat-food",
      key: "food",
      label: "Food",
      nature: "essential",
      total: "300.00",
      percentOfExpenses: 75,
      transactionCount: 2,
    },
  ],
};

const ANT: AntExpensesView = {
  period: PERIOD,
  totalDiscretionary: "15.00",
  groups: [
    {
      groupKind: "merchant",
      key: "cafe central",
      label: "cafe central",
      operationCount: 3,
      total: "15.00",
      average: "5.00",
      percentOfDiscretionary: 100,
      confidence: "high",
      transactionIds: ["tx-1", "tx-2", "tx-3"],
    },
  ],
};

const SAVINGS: MonthlySavingsView = {
  period: PERIOD,
  income: "10000.00",
  expense: "4000.00",
  saved: "6000.00",
  observedRate: "60.00",
  note: null,
  deficit: null,
};

function bundle(
  overrides: Partial<MonthlyReportBundle> = {},
): MonthlyReportBundle {
  return {
    metadata: METADATA,
    cashFlow: CASH_FLOW,
    expensesByCategory: EXPENSES,
    antExpenses: ANT,
    monthlySavings: SAVINGS,
    ...overrides,
  };
}

describe("reportExportTables", () => {
  it("emits the metadata block first, then the four sections in contract order", () => {
    const tables = reportExportTables(bundle());

    expect(tables.map((t) => t.name)).toEqual([
      "metadata",
      "cash-flow",
      "expenses-by-category",
      "ant-expenses",
      "monthly-savings",
    ]);
  });

  it("carries the metadata keys and the contract column headers per section", () => {
    const [meta, cashFlow, byCategory, ant, savings] = reportExportTables(
      bundle(),
    );

    expect(meta?.columns).toEqual(["key", "value"]);
    expect(meta?.rows).toEqual([
      ["timezone", "UTC"],
      ["currency", "EUR"],
      ["from", "2026-09-01"],
      ["to", "2026-09-30"],
      ["periodStatus", "provisional"],
      ["generatedAt", "2026-10-01T12:00:00.000Z"],
    ]);
    expect(cashFlow?.columns).toEqual([
      "account",
      "income",
      "expense",
      "transfersIn",
      "transfersOut",
      "netFlow",
    ]);
    expect(byCategory?.columns).toEqual([
      "category",
      "nature",
      "total",
      "percent",
      "count",
    ]);
    expect(ant?.columns).toEqual([
      "group",
      "kind",
      "ops",
      "total",
      "average",
      "percentOfDiscretionary",
      "confidence",
    ]);
    expect(savings?.columns).toEqual([
      "income",
      "expense",
      "saved",
      "observedRate",
      "deficit",
      "note",
    ]);
  });

  it("labels the unassigned account group and emits amounts verbatim as strings", () => {
    const [, cashFlow] = reportExportTables(bundle());

    expect(cashFlow?.rows).toEqual([
      ["Checking", "100.00", "40.50", "0.00", "38.00", "21.50"],
      ["(unassigned)", "0.00", "15.25", "8.00", "0.00", "-7.25"],
    ]);
  });

  it("renders the monthly-savings section as a single row with nulls as empty cells", () => {
    const deficit: MonthlySavingsView = {
      ...SAVINGS,
      saved: "-500.00",
      observedRate: "0.00",
      note: "deficit",
      deficit: "500.00",
    };
    const [,,,, savings] = reportExportTables(
      bundle({ monthlySavings: deficit }),
    );

    expect(savings?.rows).toEqual([
      ["10000.00", "4000.00", "-500.00", "0.00", "500.00", "deficit"],
    ]);
  });
});

describe("serializeReportCsv", () => {
  it("emits the full flat document: ## section headers, column rows and data rows", () => {
    const csv = serializeReportCsv(bundle());

    expect(csv).toBe(
      [
        "\ufeff## metadata",
        "key,value",
        "timezone,UTC",
        "currency,EUR",
        "from,2026-09-01",
        "to,2026-09-30",
        "periodStatus,provisional",
        "generatedAt,2026-10-01T12:00:00.000Z",
        "",
        "## cash-flow",
        "account,income,expense,transfersIn,transfersOut,netFlow",
        "Checking,100.00,40.50,0.00,38.00,21.50",
        "(unassigned),0.00,15.25,8.00,0.00,-7.25",
        "",
        "## expenses-by-category",
        "category,nature,total,percent,count",
        "Food,essential,300.00,75,2",
        "",
        "## ant-expenses",
        "group,kind,ops,total,average,percentOfDiscretionary,confidence",
        "cafe central,merchant,3,15.00,5.00,100,high",
        "",
        "## monthly-savings",
        "income,expense,saved,observedRate,deficit,note",
        "10000.00,4000.00,6000.00,60.00,,",
        "",
      ].join("\n"),
    );
  });

  it("quotes cells containing commas, double quotes or newlines (RFC 4180)", () => {
    const tricky: CashFlowReportView = {
      period: PERIOD,
      accounts: [
        {
          accountId: "acc-9",
          name: 'Cash "wallet", main\nvault',
          kind: "cash",
          income: "1.00",
          expense: "0.00",
          transfersIn: "0.00",
          transfersOut: "0.00",
          netFlow: "1.00",
        },
      ],
    };

    const csv = serializeReportCsv(bundle({ cashFlow: tricky }));

    expect(csv).toContain(
      '"Cash ""wallet"", main\nvault",1.00,0.00,0.00,0.00,1.00',
    );
  });

  it("keeps non-ASCII labels (UTF-8) untouched", () => {
    const latin: ExpensesByCategoryView = {
      ...EXPENSES,
      categories: [
        {
          categoryId: null,
          key: "uncategorized",
          label: "Sin categorizar",
          nature: "uncategorized",
          total: "42.10",
          percentOfExpenses: 100,
          transactionCount: 1,
        },
      ],
    };

    const csv = serializeReportCsv(bundle({ expensesByCategory: latin }));

    expect(csv).toContain("Sin categorizar,uncategorized,42.10,100,1");
  });

  it("neutralizes leading = + - @ so labels cannot run as formulas (R3-001)", () => {
    const csv = serializeReportCsv(
      bundle({
        expensesByCategory: {
          ...EXPENSES,
          categories: [
            {
              categoryId: "c1",
              key: "evil",
              label: "=cmd|'/tmp'",
              nature: "discretionary",
              total: "1.00",
              percentOfExpenses: 100,
              transactionCount: 1,
            },
          ],
        },
      }),
    );
    expect(csv).toContain("'=cmd|'/tmp'");
    expect(csv.startsWith("\ufeff")).toBe(true); // BOM for Excel UTF-8 (R3-003)
  });

  it("emits only the header row for sections without rows", () => {
    const csv = serializeReportCsv(
      bundle({
        cashFlow: { period: PERIOD, accounts: [] },
        antExpenses: { ...ANT, groups: [] },
      }),
    );

    expect(csv).toContain(
      "## cash-flow\naccount,income,expense,transfersIn,transfersOut,netFlow\n\n## expenses-by-category",
    );
    expect(csv).toContain(
      "## ant-expenses\ngroup,kind,ops,total,average,percentOfDiscretionary,confidence\n\n## monthly-savings",
    );
  });
});
