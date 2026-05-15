import { appendAppLog } from "./app-logs";
import type { ConnectionPayload } from "./connections";
import { parseJsonResponse } from "./parse-json-response";

export type CellValue = string | number | boolean | null;

export type QueryResult = {
  columns: string[];
  rows: CellValue[][];
  row_count: number;
  timing_only?: boolean;
  duration_ms?: number;
  timing_note?: string | null;
};

export type TableApiRecordsRequest = {
  table: string;
  connection?: ConnectionPayload;
  sysparm_query?: string | null;
  sysparm_fields?: string | null;
  sysparm_limit?: number | null;
  sysparm_offset?: number | null;
  sysparm_display_value?: string | null;
  sysparm_exclude_reference_link?: boolean | null;
  sysparm_view?: string | null;
  sysparm_query_no_domain?: boolean | null;
  sysparm_suppress_pagination_header?: boolean | null;
  timing_only?: boolean;
};

export type TableApiRecordsResponse = QueryResult & {
  total_count: number | null;
  duration_ms: number;
  request_path: string;
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

export type EgressIpInfo = {
  ip: string | null;
  error: string | null;
};

export type AboutInfo = {
  author: string;
  linkedin: string | null;
  repository: string | null;
  license: string;
  license_summary: string;
  disclaimer: string;
  tagline: string;
  banner: string;
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
};

export type ColumnsResponse = {
  table: string;
  columns: ColumnInfo[];
};

export const isAbortError = (err: unknown): boolean =>
  (typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError") ||
  (err instanceof Error && err.name === "AbortError");

const elapsedMs = (started: number): string =>
  `${Math.round(performance.now() - started)}ms`;

const previewSql = (query: string, max = 280): string => {
  const collapsed = query.trim().replace(/\s+/g, " ");
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}…`;
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
  return parseJsonResponse<T>(response);
};

export const runTableApiRecords = async (
  body: TableApiRecordsRequest,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<TableApiRecordsResponse> => {
  const t0 = performance.now();
  const detail = `${body.table}${body.sysparm_query ? ` · ${body.sysparm_query.slice(0, 120)}` : ""}`;
  appendAppLog({
    level: "info",
    category: "Table API",
    message: `POST /table-api/records${body.connection ? " (custom connection)" : " (.env)"}`,
    detail,
  });
  const payload: Record<string, unknown> = { table: body.table };
  if (body.connection) payload.connection = body.connection;
  if (body.sysparm_query != null && body.sysparm_query !== "")
    payload.sysparm_query = body.sysparm_query;
  if (body.sysparm_fields != null && body.sysparm_fields !== "")
    payload.sysparm_fields = body.sysparm_fields;
  if (body.sysparm_limit != null) payload.sysparm_limit = body.sysparm_limit;
  if (body.sysparm_offset != null) payload.sysparm_offset = body.sysparm_offset;
  if (body.sysparm_display_value != null && body.sysparm_display_value !== "")
    payload.sysparm_display_value = body.sysparm_display_value;
  if (body.sysparm_exclude_reference_link != null) {
    payload.sysparm_exclude_reference_link = body.sysparm_exclude_reference_link;
  }
  if (body.sysparm_view != null && body.sysparm_view !== "")
    payload.sysparm_view = body.sysparm_view;
  if (body.sysparm_query_no_domain != null) {
    payload.sysparm_query_no_domain = body.sysparm_query_no_domain;
  }
  if (body.sysparm_suppress_pagination_header != null) {
    payload.sysparm_suppress_pagination_header =
      body.sysparm_suppress_pagination_header;
  }
  if (body.timing_only) payload.timing_only = true;
  try {
    const result = await post<TableApiRecordsResponse>(
      "/table-api/records",
      payload,
      apiKey,
      signal,
    );
    appendAppLog({
      level: "success",
      category: "Table API",
      message: `${result.row_count.toLocaleString()} row(s) · server ${result.duration_ms}ms · client ${elapsedMs(t0)}`,
      detail,
    });
    return result;
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "Table API",
      message: `${message} · ${elapsedMs(t0)}`,
      detail,
    });
    throw err;
  }
};

export const runQuery = async (
  query: string,
  connection: ConnectionPayload | undefined,
  apiKey: string | null,
  signal?: AbortSignal,
  options?: { timingOnly?: boolean },
): Promise<QueryResult> => {
  const t0 = performance.now();
  const detail = previewSql(query);
  appendAppLog({
    level: "info",
    category: "Query",
    message: `POST /query${connection ? " (custom connection)" : " (.env)"}`,
    detail,
  });
  try {
    const body: Record<string, unknown> = connection
      ? { query, connection }
      : { query };
    if (options?.timingOnly) body.timing_only = true;
    const result = await post<QueryResult>("/query", body, apiKey, signal);
    appendAppLog({
      level: "success",
      category: "Query",
      message: `${result.row_count.toLocaleString()} row(s) · ${elapsedMs(t0)}`,
      detail,
    });
    return result;
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "Query",
      message: `${message} · ${elapsedMs(t0)}`,
      detail,
    });
    throw err;
  }
};

export const fetchTables = async (
  connection: ConnectionPayload | undefined,
  pattern: string | null,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<TablesResponse> => {
  const t0 = performance.now();
  const body: Record<string, unknown> = {};
  if (connection) body.connection = connection;
  if (pattern && pattern.trim()) body.pattern = pattern.trim();
  appendAppLog({
    level: "info",
    category: "Schema",
    message: `POST /schema/tables${pattern?.trim() ? ` · pattern "${pattern.trim()}"` : ""}`,
  });
  try {
    const data = await post<TablesResponse>(
      "/schema/tables",
      body,
      apiKey,
      signal,
    );
    appendAppLog({
      level: "success",
      category: "Schema",
      message: `${data.total.toLocaleString()} table(s) · ${elapsedMs(t0)}`,
    });
    return data;
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "Schema",
      message: `Tables: ${message} · ${elapsedMs(t0)}`,
    });
    throw err;
  }
};

export const fetchColumns = async (
  table: string,
  connection: ConnectionPayload | undefined,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<ColumnsResponse> => {
  const t0 = performance.now();
  const body: Record<string, unknown> = { table };
  if (connection) body.connection = connection;
  appendAppLog({
    level: "info",
    category: "Schema",
    message: `POST /schema/columns · table ${table}`,
  });
  try {
    const data = await post<ColumnsResponse>(
      "/schema/columns",
      body,
      apiKey,
      signal,
    );
    appendAppLog({
      level: "success",
      category: "Schema",
      message: `${data.columns.length} column(s) on ${table} · ${elapsedMs(t0)}`,
    });
    return data;
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "Schema",
      message: `Columns (${table}): ${message} · ${elapsedMs(t0)}`,
    });
    throw err;
  }
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

export const fetchEgressIp = async (
  signal?: AbortSignal,
): Promise<EgressIpInfo> => {
  const t0 = performance.now();
  appendAppLog({
    level: "info",
    category: "Network",
    message: "GET /egress-ip",
  });
  try {
    const response = await fetch("/egress-ip", { signal });
    if (!response.ok) {
      appendAppLog({
        level: "error",
        category: "Network",
        message: `/egress-ip · HTTP ${response.status} · ${elapsedMs(t0)}`,
      });
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as EgressIpInfo;
    if (data.ip) {
      appendAppLog({
        level: "success",
        category: "Network",
        message: `Egress IP ${data.ip} · ${elapsedMs(t0)}`,
      });
    } else if (data.error) {
      appendAppLog({
        level: "warn",
        category: "Network",
        message: `${data.error} · ${elapsedMs(t0)}`,
      });
    } else {
      appendAppLog({
        level: "warn",
        category: "Network",
        message: `No IP in response · ${elapsedMs(t0)}`,
      });
    }
    return data;
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "Network",
      message: `/egress-ip · ${message} · ${elapsedMs(t0)}`,
    });
    throw err;
  }
};

export const fetchAbout = async (signal?: AbortSignal): Promise<AboutInfo> => {
  const t0 = performance.now();
  appendAppLog({
    level: "info",
    category: "HTTP",
    message: "GET /about",
  });
  try {
    const response = await fetch("/about", { signal });
    if (!response.ok) {
      appendAppLog({
        level: "error",
        category: "HTTP",
        message: `/about · HTTP ${response.status} · ${elapsedMs(t0)}`,
      });
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as AboutInfo;
    appendAppLog({
      level: "success",
      category: "HTTP",
      message: `About · ${data.tagline.slice(0, 80)}${data.tagline.length > 80 ? "…" : ""} · ${elapsedMs(t0)}`,
    });
    return data;
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    appendAppLog({
      level: "error",
      category: "HTTP",
      message: `/about · ${message} · ${elapsedMs(t0)}`,
    });
    throw err;
  }
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
    const errText = await extractDetail(response);
    return {
      status: "error",
      instance: null,
      driver_class: null,
      error: errText,
    };
  }
  return (await response.json()) as HealthCheckResult;
};
