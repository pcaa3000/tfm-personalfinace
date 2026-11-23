import type { ReportPeriodStatus } from "../domain/report-period.js";
import type { AntExpensesView } from "./ant-expenses.view.js";
import type { CashFlowReportView } from "./cash-flow.view.js";
import type { ExpensesByCategoryView } from "./expenses-by-category.view.js";
import type { MonthlySavingsView } from "./monthly-savings.view.js";

/**
 * Downloadable monthly report (reports-monthly T10, S9/CA-022): the
 * four report views plus the metadata block that always precedes them
 * in the exported file — workspace timezone, currency, resolved period
 * bounds and status, and the generation timestamp.
 */
export interface ReportExportMetadata {
  readonly timezone: string;
  readonly currency: string;
  readonly from: string;
  readonly to: string;
  readonly periodStatus: ReportPeriodStatus;
  /** ISO 8601 instant the export was generated. */
  readonly generatedAt: string;
}

export interface MonthlyReportBundle {
  readonly metadata: ReportExportMetadata;
  readonly cashFlow: CashFlowReportView;
  readonly expensesByCategory: ExpensesByCategoryView;
  readonly antExpenses: AntExpensesView;
  readonly monthlySavings: MonthlySavingsView;
}

/**
 * One flat table per exported section — the shared shape both
 * serializers (CSV in application/, XLSX adapter in infrastructure/)
 * consume so the two formats can never diverge on columns or rows.
 */
export interface ReportExportTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

/** Label for the cash-flow group aggregating accountless rows. */
const UNASSIGNED_ACCOUNT = "(unassigned)";

/**
 * Flattens the bundle into the five contract tables, in fixed order:
 * metadata first, then cash-flow, expenses-by-category, ant-expenses
 * and monthly-savings. Amounts pass through verbatim — the views
 * already produce decimal strings (INV-DIN-03).
 */
export function reportExportTables(
  bundle: MonthlyReportBundle,
): ReportExportTable[] {
  const { metadata } = bundle;
  return [
    {
      name: "metadata",
      columns: ["key", "value"],
      rows: [
        ["timezone", metadata.timezone],
        ["currency", metadata.currency],
        ["from", metadata.from],
        ["to", metadata.to],
        ["periodStatus", metadata.periodStatus],
        ["generatedAt", metadata.generatedAt],
      ],
    },
    {
      name: "cash-flow",
      columns: [
        "account",
        "income",
        "expense",
        "transfersIn",
        "transfersOut",
        "netFlow",
      ],
      rows: bundle.cashFlow.accounts.map((account) => [
        account.name ?? UNASSIGNED_ACCOUNT,
        account.income,
        account.expense,
        account.transfersIn,
        account.transfersOut,
        account.netFlow,
      ]),
    },
    {
      name: "expenses-by-category",
      columns: ["category", "nature", "total", "percent", "count"],
      rows: bundle.expensesByCategory.categories.map((category) => [
        category.label,
        category.nature,
        category.total,
        category.percentOfExpenses,
        category.transactionCount,
      ]),
    },
    {
      name: "ant-expenses",
      columns: [
        "group",
        "kind",
        "ops",
        "total",
        "average",
        "percentOfDiscretionary",
        "confidence",
      ],
      rows: bundle.antExpenses.groups.map((group) => [
        group.label,
        group.groupKind,
        group.operationCount,
        group.total,
        group.average,
        group.percentOfDiscretionary,
        group.confidence,
      ]),
    },
    {
      name: "monthly-savings",
      columns: ["income", "expense", "saved", "observedRate", "deficit", "note"],
      rows: [
        [
          bundle.monthlySavings.income,
          bundle.monthlySavings.expense,
          bundle.monthlySavings.saved,
          bundle.monthlySavings.observedRate ?? "",
          bundle.monthlySavings.deficit ?? "",
          bundle.monthlySavings.note ?? "",
        ],
      ],
    },
  ];
}

/**
 * Neutralize spreadsheet-formula execution: a leading = + - or @ turns a
 * user-controlled label into a formula when the file is opened in Excel
 * or Sheets — prefixing with ' forces text interpretation (R3-001).
 */
export function neutralizeSpreadsheetCell(
  value: string | number,
): string | number {
  const text = String(value);
  // Only non-numeric text with a formula-leading char is neutralized —
  // numeric strings (amounts, incl. negative) are safe as-is.
  if (!/^[=+\-@]/.test(text) || !Number.isNaN(Number(text))) {
    return value;
  }
  return `'${text}`;
}

/** RFC 4180 cell escaping: quote when the value holds , " CR or LF. */
function csvCell(value: string | number): string {
  const text = String(neutralizeSpreadsheetCell(value));
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Flat UTF-8 CSV: each table becomes a `## <name>` header, a column
 * row and its data rows, sections separated by a blank line. No
 * dependency — hand-rolled quoting keeps INV-DIN-03 decimals as
 * literal strings.
 */
export function serializeReportCsv(bundle: MonthlyReportBundle): string {
  const lines: string[] = [];
  for (const table of reportExportTables(bundle)) {
    lines.push(`## ${table.name}`);
    lines.push(table.columns.join(","));
    for (const row of table.rows) {
      lines.push(row.map(csvCell).join(","));
    }
    lines.push("");
  }
  // \uFEFF BOM so Excel decodes UTF-8 instead of ANSI (R3-003).
  return "\ufeff" + lines.join("\n");
}
