import type { MonthlyReportBundle } from "../report-export.serializer.js";

/**
 * Binary spreadsheet serializer (reports-monthly T10, S9): the
 * dependency-cruiser core rules keep npm packages out of application/,
 * so the exceljs implementation lives in infrastructure behind this
 * port and the use case only sees bytes.
 */
export interface XlsxReportSerializerPort {
  serialize(bundle: MonthlyReportBundle): Promise<Uint8Array<ArrayBuffer>>;
}

export const XLSX_REPORT_SERIALIZER = Symbol("XLSX_REPORT_SERIALIZER");
