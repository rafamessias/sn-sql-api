import type { CellValue, QueryResult } from "./api";

const escapeCell = (value: CellValue): string => {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const tabularToCsv = (
  columns: readonly string[],
  rows: readonly (readonly CellValue[])[],
): string => {
  const header = columns.map(escapeCell).join(",");
  const lines = rows.map((row) => row.map(escapeCell).join(","));
  return [header, ...lines].join("\n");
};

export const resultToCsv = (result: QueryResult): string =>
  tabularToCsv(result.columns, result.rows);
