import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ReportPeriod } from "../domain/report-period.js";
import type { MonthlyReportBundle } from "../application/report-export.serializer.js";
import { ExcelJsReportExportAdapter } from "./exceljs-report-export.adapter.js";

const PERIOD: ReportPeriod = {
  from: "2026-09-01",
  to: "2026-09-30",
  currency: "EUR",
  periodStatus: "provisional",
};

const BUNDLE: MonthlyReportBundle = {
  metadata: {
    timezone: "Europe/Madrid",
    currency: "EUR",
    from: "2026-09-01",
    to: "2026-09-30",
    periodStatus: "provisional",
    generatedAt: "2026-10-01T12:00:00.000Z",
  },
  cashFlow: {
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
    ],
  },
  expensesByCategory: {
    period: PERIOD,
    totalExpenses: "400.00",
    natureTotals: { essential: "400.00" },
    categories: [
      {
        categoryId: "cat-food",
        key: "food",
        label: "Food",
        nature: "essential",
        total: "400.00",
        percentOfExpenses: 100,
        transactionCount: 2,
      },
    ],
  },
  avoidableExpenses: {
    period: PERIOD,
    totalDiscretionary: "15.00",
    potentialSavings: "15.00",
    groups: [
      {
        detectors: ["ant", "recurring_charge"],
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
  },
  monthlySavings: {
    period: PERIOD,
    income: "10000.00",
    expense: "4000.00",
    saved: "6000.00",
    observedRate: "60.00",
    note: null,
    deficit: null,
  },
};

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook;
}

function sheetValues(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  worksheet.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

describe("ExcelJsReportExportAdapter", () => {
  it("writes a valid xlsx with one sheet per section plus Metadata first", async () => {
    const adapter = new ExcelJsReportExportAdapter();

    const bytes = await adapter.serialize(BUNDLE);
    const workbook = await loadWorkbook(bytes);

    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      "Metadata",
      "Cash flow",
      "Expenses by category",
      "Avoidable expenses",
      "Monthly savings",
    ]);
  });

  it("writes the metadata block as key/value rows", async () => {
    const adapter = new ExcelJsReportExportAdapter();

    const workbook = await loadWorkbook(await adapter.serialize(BUNDLE));
    const meta = workbook.getWorksheet("Metadata");

    expect(sheetValues(meta!)).toEqual([
      ["key", "value"],
      ["timezone", "Europe/Madrid"],
      ["currency", "EUR"],
      ["from", "2026-09-01"],
      ["to", "2026-09-30"],
      ["periodStatus", "provisional"],
      ["generatedAt", "2026-10-01T12:00:00.000Z"],
    ]);
  });

  it("stores formula-leading labels as literal strings (shared strings, no prefix)", async () => {
    const adapter = new ExcelJsReportExportAdapter();
    const bundle: MonthlyReportBundle = {
      ...BUNDLE,
      cashFlow: {
        period: PERIOD,
        accounts: [
          {
            accountId: "acc-1",
            name: "=SUM(1;2)",
            kind: "bank",
            income: "100.00",
            expense: "40.50",
            transfersIn: "0.00",
            transfersOut: "38.00",
            netFlow: "21.50",
          },
        ],
      },
    };

    const workbook = await loadWorkbook(await adapter.serialize(bundle));
    const row = sheetValues(workbook.getWorksheet("Cash flow")!)[1]!;

    // ExcelJS writes strings as shared strings — the label lands
    // verbatim, never as a formula, and without a visible ' prefix.
    expect(row[0]).toBe("=SUM(1;2)");
  });

  it("writes each section sheet with the contract columns and verbatim amounts", async () => {
    const adapter = new ExcelJsReportExportAdapter();

    const workbook = await loadWorkbook(await adapter.serialize(BUNDLE));

    expect(sheetValues(workbook.getWorksheet("Cash flow")!)).toEqual([
      ["account", "income", "expense", "transfersIn", "transfersOut", "netFlow"],
      ["Checking", "100.00", "40.50", "0.00", "38.00", "21.50"],
    ]);
    expect(
      sheetValues(workbook.getWorksheet("Expenses by category")!),
    ).toEqual([
      ["category", "nature", "total", "percent", "count"],
      ["Food", "essential", "400.00", 100, 2],
    ]);
    expect(
      sheetValues(workbook.getWorksheet("Avoidable expenses")!),
    ).toEqual([
      [
        "group",
        "kind",
        "detectors",
        "ops",
        "total",
        "average",
        "percentOfDiscretionary",
        "confidence",
      ],
      [
        "cafe central",
        "merchant",
        "ant|recurring_charge",
        3,
        "15.00",
        "5.00",
        100,
        "high",
      ],
    ]);
    expect(sheetValues(workbook.getWorksheet("Monthly savings")!)).toEqual([
      ["income", "expense", "saved", "observedRate", "deficit", "note"],
      ["10000.00", "4000.00", "6000.00", "60.00", "", ""],
    ]);
  });
});
