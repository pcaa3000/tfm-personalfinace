import ExcelJS from "exceljs";

import type { XlsxReportSerializerPort } from "../application/ports/xlsx-report-export.port.js";
import {
  reportExportTables,
  type MonthlyReportBundle,
} from "../application/report-export.serializer.js";

/** Table name → worksheet title (Excel allows spaces, 31-char cap). */
const SHEET_NAMES: Record<string, string> = {
  metadata: "Metadata",
  "cash-flow": "Cash flow",
  "expenses-by-category": "Expenses by category",
  "avoidable-expenses": "Avoidable expenses",
  "monthly-savings": "Monthly savings",
};

/**
 * XLSX serializer for the monthly report export (reports-monthly T10,
 * S9): one worksheet per section plus the Metadata sheet first, all
 * built from the same flattened tables the CSV serializer emits —
 * amounts stay the verbatim decimal strings the views produce.
 */
export class ExcelJsReportExportAdapter implements XlsxReportSerializerPort {
  async serialize(
    bundle: MonthlyReportBundle,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const workbook = new ExcelJS.Workbook();
    for (const table of reportExportTables(bundle)) {
      const sheet = workbook.addWorksheet(
        SHEET_NAMES[table.name] ?? table.name,
      );
      sheet.addRow([...table.columns]);
      for (const row of table.rows) {
        // ExcelJS stores strings as shared strings — never formulas —
        // so no neutralization is needed here (csv path handles it).
        sheet.addRow([...row]);
      }
    }
    // exceljs' Buffer is an ArrayBuffer in its own typings — wrap it
    // in a Uint8Array view for the HTTP response.
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }
}
