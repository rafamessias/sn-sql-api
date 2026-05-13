import type { ColumnInfo } from "./api";

const STORAGE_KEY_PREFIX = "sn-sql-api:schema-columns:v1:";

const storageKey = (payloadKey: string, table: string): string =>
  `${STORAGE_KEY_PREFIX}${payloadKey}::${encodeURIComponent(table)}`;

const isColumnInfoRecord = (value: unknown): value is ColumnInfo => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as { name?: unknown; type?: unknown; nullable?: unknown };
  return (
    typeof row.name === "string" &&
    typeof row.type === "string" &&
    typeof row.nullable === "boolean"
  );
};

export const readSchemaColumnsCache = (
  payloadKey: string,
  table: string,
): ColumnInfo[] | null => {
  try {
    const raw = localStorage.getItem(storageKey(payloadKey, table));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const columns = (parsed as { columns?: unknown }).columns;
    if (!Array.isArray(columns) || !columns.every(isColumnInfoRecord)) return null;
    if (columns.length === 0) return null;
    return columns;
  } catch {
    return null;
  }
};

export const writeSchemaColumnsCache = (
  payloadKey: string,
  table: string,
  columns: ColumnInfo[],
): void => {
  if (columns.length === 0) return;
  try {
    localStorage.setItem(
      storageKey(payloadKey, table),
      JSON.stringify({ columns }),
    );
  } catch {
    // Quota, private mode, or disabled storage — ignore
  }
};

export const deleteSchemaColumnsCache = (
  payloadKey: string,
  table: string,
): void => {
  try {
    localStorage.removeItem(storageKey(payloadKey, table));
  } catch {
    // ignore
  }
};
