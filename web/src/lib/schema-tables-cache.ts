import type { TableInfo } from "./api";

const STORAGE_KEY_PREFIX = "sn-sql-api:schema-tables:v1:";

const isTableInfoRecord = (value: unknown): value is TableInfo => {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { name?: unknown }).name === "string";
};

export const readSchemaTablesCache = (payloadKey: string): TableInfo[] | null => {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${payloadKey}`);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const tables = (parsed as { tables?: unknown }).tables;
    if (!Array.isArray(tables) || !tables.every(isTableInfoRecord)) return null;
    return tables;
  } catch {
    return null;
  }
};

export const writeSchemaTablesCache = (
  payloadKey: string,
  tables: TableInfo[],
): void => {
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${payloadKey}`,
      JSON.stringify({ tables }),
    );
  } catch {
    // Quota, private mode, or disabled storage — ignore
  }
};
