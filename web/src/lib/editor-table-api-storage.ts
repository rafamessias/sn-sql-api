import type { TableApiRecordsResponse } from "./api";
import { sanitizeQueryResult } from "./editor-query-results-storage";
import type { TableApiFormState } from "./table-api-form";

const FORMS_KEY = "sn-sql-api:editorTableApiForms:v1";
const RESULTS_KEY = "sn-sql-api:editorTableApiResults:v1";

const isDisplayValue = (
  v: unknown,
): v is TableApiFormState["sysparm_display_value"] =>
  v === "" || v === "true" || v === "false" || v === "all";

export const sanitizeTableApiForm = (raw: unknown): TableApiFormState | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const display = o.sysparm_display_value;
  return {
    table: typeof o.table === "string" ? o.table : "",
    sysparm_query: typeof o.sysparm_query === "string" ? o.sysparm_query : "",
    sysparm_fields: typeof o.sysparm_fields === "string" ? o.sysparm_fields : "",
    sysparm_limit: typeof o.sysparm_limit === "string" ? o.sysparm_limit : "100",
    sysparm_offset: typeof o.sysparm_offset === "string" ? o.sysparm_offset : "",
    sysparm_view: typeof o.sysparm_view === "string" ? o.sysparm_view : "",
    sysparm_display_value: isDisplayValue(display) ? display : "",
    sysparm_exclude_reference_link: Boolean(o.sysparm_exclude_reference_link),
  };
};

export const sanitizeTableApiRecordsResponse = (
  raw: unknown,
): TableApiRecordsResponse | null => {
  const base = sanitizeQueryResult(raw);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  const tc = o.total_count;
  const total_count =
    tc === null
      ? null
      : typeof tc === "number" && Number.isFinite(tc)
        ? Math.floor(tc)
        : null;
  const duration_ms =
    typeof o.duration_ms === "number" && Number.isFinite(o.duration_ms)
      ? o.duration_ms
      : 0;
  const request_path =
    typeof o.request_path === "string" ? o.request_path : "";
  return { ...base, total_count, duration_ms, request_path };
};

const sanitizeFormMap = (raw: unknown): Record<string, TableApiFormState> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TableApiFormState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || !id.trim()) continue;
    const parsed = sanitizeTableApiForm(value);
    if (parsed) out[id] = parsed;
  }
  return out;
};

const sanitizeTableApiResultsMap = (
  raw: unknown,
): Record<string, TableApiRecordsResponse | null> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TableApiRecordsResponse | null> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || !id.trim()) continue;
    if (value === null) {
      out[id] = null;
      continue;
    }
    const parsed = sanitizeTableApiRecordsResponse(value);
    if (parsed) out[id] = parsed;
  }
  return out;
};

export const loadTableApiFormsByTab = (): Record<string, TableApiFormState> => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FORMS_KEY);
    if (!raw) return {};
    return sanitizeFormMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
};

export const persistTableApiFormsByTab = (
  map: Record<string, TableApiFormState>,
): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FORMS_KEY, JSON.stringify(map));
  } catch {
    // quota / private mode
  }
};

export const loadTableApiResultsByTab = (): Record<
  string,
  TableApiRecordsResponse | null
> => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return {};
    return sanitizeTableApiResultsMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
};

export const persistTableApiResultsByTab = (
  map: Record<string, TableApiRecordsResponse | null>,
): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(map));
  } catch {
    // quota / private mode
  }
};

export const clearTableApiResultsByTabStorage = (): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RESULTS_KEY);
  } catch {
    // ignore
  }
};
