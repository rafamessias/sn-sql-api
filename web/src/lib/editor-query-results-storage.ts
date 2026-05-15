import type { CellValue, QueryResult } from "./api";

const STORAGE_KEY = "sn-sql-api:editorQueryResults:v1";

const isCellValue = (v: unknown): v is CellValue => {
  if (v === null) return true;
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
};

export const sanitizeQueryResult = (raw: unknown): QueryResult | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.columns)) return null;
  const columns = o.columns.filter((c): c is string => typeof c === "string");
  if (!Array.isArray(o.rows)) return null;
  const rows: CellValue[][] = [];
  for (const row of o.rows) {
    if (!Array.isArray(row)) return null;
    if (columns.length > 0 && row.length !== columns.length) return null;
    const cells: CellValue[] = [];
    for (const cell of row) {
      if (!isCellValue(cell)) return null;
      cells.push(cell);
    }
    rows.push(cells);
  }
  if (columns.length === 0 && rows.length > 0) return null;
  const rc = o.row_count;
  const row_count =
    typeof rc === "number" && Number.isFinite(rc) && rc >= 0
      ? Math.floor(rc)
      : rows.length;
  const out: QueryResult = { columns, rows, row_count };
  if (o.timing_only === true) out.timing_only = true;
  const dm = o.duration_ms;
  if (typeof dm === "number" && Number.isFinite(dm) && dm >= 0) {
    out.duration_ms = Math.floor(dm);
  }
  if (typeof o.timing_note === "string" && o.timing_note.trim()) {
    out.timing_note = o.timing_note.trim();
  }
  return out;
};

export const sanitizeResultsByTab = (
  raw: unknown,
): Record<string, QueryResult | null> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, QueryResult | null> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || !id.trim()) continue;
    if (value === null) {
      out[id] = null;
      continue;
    }
    const parsed = sanitizeQueryResult(value);
    if (parsed) out[id] = parsed;
  }
  return out;
};

export const loadQueryResultsByTab = (): Record<string, QueryResult | null> => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return sanitizeResultsByTab(parsed);
  } catch {
    return {};
  }
};

export const persistQueryResultsByTab = (
  map: Record<string, QueryResult | null>,
): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota, private mode, or disabled storage — ignore
  }
};

export const clearQueryResultsByTabStorage = (): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};
