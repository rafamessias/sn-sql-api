import type { ConnectionPayload } from "./connections";

export type CellValue = string | number | boolean | null;

export type QueryResult = {
  columns: string[];
  rows: CellValue[][];
  row_count: number;
};

export type HealthInfo = {
  status: string;
  instance: string;
  jdbc_driver_class: string;
};

export type HealthCheckResult = {
  status: "ok" | "error";
  instance: string | null;
  driver_class: string | null;
  error: string | null;
};

export type TableInfo = {
  name: string;
  schema?: string | null;
  type?: string | null;
};

export type TablesResponse = {
  tables: TableInfo[];
  total: number;
};

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  internal_type?: string | null;
  field_type?: string | null;
  function_field?: boolean | null;
};

export type ColumnsResponse = {
  table: string;
  columns: ColumnInfo[];
};

const buildHeaders = (apiKey: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
};

const extractDetail = async (response: Response): Promise<string> => {
  try {
    const body = (await response.clone().json()) as { detail?: unknown };
    if (body && typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    // fall through
  }
  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return `HTTP ${response.status}`;
};

const post = async <T>(
  url: string,
  body: Record<string, unknown>,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await extractDetail(response));
  }
  return (await response.json()) as T;
};

export const runQuery = (
  query: string,
  connection: ConnectionPayload | undefined,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<QueryResult> =>
  post<QueryResult>(
    "/query",
    connection ? { query, connection } : { query },
    apiKey,
    signal,
  );

export const fetchTables = (
  connection: ConnectionPayload | undefined,
  pattern: string | null,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<TablesResponse> => {
  const body: Record<string, unknown> = {};
  if (connection) body.connection = connection;
  if (pattern && pattern.trim()) body.pattern = pattern.trim();
  return post<TablesResponse>("/schema/tables", body, apiKey, signal);
};

export const fetchColumns = (
  table: string,
  connection: ConnectionPayload | undefined,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<ColumnsResponse> => {
  const body: Record<string, unknown> = { table };
  if (connection) body.connection = connection;
  return post<ColumnsResponse>("/schema/columns", body, apiKey, signal);
};

export const fetchHealth = async (
  signal?: AbortSignal,
): Promise<HealthInfo> => {
  const response = await fetch("/health", { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as HealthInfo;
};

export const checkConnection = async (
  connection: ConnectionPayload | undefined,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<HealthCheckResult> => {
  const body: Record<string, unknown> = {};
  if (connection) body.connection = connection;
  const response = await fetch("/health/check", {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    return {
      status: "error",
      instance: null,
      driver_class: null,
      error: await extractDetail(response),
    };
  }
  return (await response.json()) as HealthCheckResult;
};
