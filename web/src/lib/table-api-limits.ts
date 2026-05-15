import { buildServiceNowTableApiGetUrl } from "./build-servicenow-table-api-get-url";
import type { ConnectionPayload } from "./connections";
import type { TableApiFormState } from "./table-api-form";

export const TABLE_API_DOCS_URL =
  "https://www.servicenow.com/docs/r/api-reference/rest-apis/c_TableAPI.html";

/** ServiceNow community thread documenting the pagination-header 400. */
export const TABLE_API_PAGINATION_ERROR_URL =
  "https://www.servicenow.com/community/developer-forum/suddenly-started-to-get-400-bad-request/m-p/2922780";

export type TableApiLimitSeverity = "info" | "warn" | "error";

export type TableApiLimitIssue = {
  id: string;
  severity: TableApiLimitSeverity;
  title: string;
  body: string;
};

/** Documented / commonly reported ServiceNow Table API constraints (heuristic checks below). */
export const TABLE_API_LIMIT_REFERENCE = [
  {
    topic: "Rows per request (sysparm_limit)",
    limit: "Default max 10,000 per GET; instance may cap lower",
    why: "Large pages increase memory, serialization time, and timeout risk.",
  },
  {
    topic: "Pagination Link headers",
    limit: "Fails when the full GET URL is too long (~2 KB effective)",
    why: "ServiceNow embeds your query string in rel=next/prev URLs. Long sysparm_query, many sysparm_fields, or sysparm_offset make this worse.",
  },
  {
    topic: "“Pagination not supported” (HTTP 400)",
    limit: "Typical when limit ≤ 233 and URL is long",
    why: "Shorten sysparm_query/fields, set sysparm_suppress_pagination_header=true, or use sysparm_limit > 233 (ServiceNow’s documented workarounds).",
  },
  {
    topic: "sysparm_fields omitted",
    limit: "All columns returned",
    why: "Same row count with far more JSON than a short field list — slower and heavier than JDBC for wide tables.",
  },
  {
    topic: "sysparm_display_value=all",
    limit: "Roughly doubles field payload",
    why: "Each field may include display and stored values — fine for small pages, costly with many columns.",
  },
  {
    topic: "Encoded query vs SQL",
    limit: "Not every JDBC expression maps",
    why: "Joins, functions, and subqueries need REST alternatives or multiple calls.",
  },
] as const;

const LIMIT_MAX_ROWS = 10_000;
const PAGINATION_HEADER_LIMIT_MAX = 233;
const QUERY_CHARS_WARN = 500;
const QUERY_CHARS_HIGH = 1_000;
const URL_CHARS_WARN = 1_400;
const URL_CHARS_HIGH = 2_000;
const FIELD_COUNT_WARN = 15;
const FIELD_COUNT_HIGH = 30;

const ESTIMATE_CONNECTION: ConnectionPayload = {
  url: "jdbc:servicenow://https://example.service-now.com",
  user: "estimate",
  password: "",
};

const countSysparmFields = (raw: string): number =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;

const parsePositiveInt = (raw: string): number | null => {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const parseOffset = (raw: string): number | null => {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const estimateGetUrlLength = (
  form: TableApiFormState,
  connection: ConnectionPayload | undefined,
): number => {
  const conn = connection?.url?.trim() ? connection : ESTIMATE_CONNECTION;
  const built = buildServiceNowTableApiGetUrl(conn, form);
  return built?.url.length ?? 0;
};

const formHasTableApiInput = (form: TableApiFormState): boolean =>
  Boolean(
    form.table.trim() ||
      form.sysparm_query.trim() ||
      form.sysparm_fields.trim() ||
      form.sysparm_limit.trim() ||
      form.sysparm_offset.trim() ||
      form.sysparm_view.trim() ||
      form.sysparm_display_value,
  );

/**
 * Best-effort client-side checks before calling ServiceNow.
 * Thresholds are conservative heuristics — the instance may fail earlier or later.
 */
export const analyzeTableApiLimits = (
  form: TableApiFormState,
  connection: ConnectionPayload | undefined,
): TableApiLimitIssue[] => {
  if (!formHasTableApiInput(form)) return [];

  const issues: TableApiLimitIssue[] = [];
  const queryLen = form.sysparm_query.trim().length;
  const fieldCount = countSysparmFields(form.sysparm_fields);
  const allColumns = !form.sysparm_fields.trim();
  const limit = parsePositiveInt(form.sysparm_limit);
  const offset = parseOffset(form.sysparm_offset);
  const suppress = form.sysparm_suppress_pagination_header;
  const displayAll = form.sysparm_display_value === "all";
  const urlLen = estimateGetUrlLength(form, connection);
  const needsPaginationHeaders =
    !suppress && (limit == null || limit <= PAGINATION_HEADER_LIMIT_MAX);

  if (needsPaginationHeaders) {
    const paginationRisk =
      urlLen >= URL_CHARS_HIGH ||
      queryLen >= QUERY_CHARS_HIGH ||
      (allColumns && queryLen >= QUERY_CHARS_WARN) ||
      fieldCount >= FIELD_COUNT_HIGH;

    if (paginationRisk) {
      issues.push({
        id: "pagination-not-supported",
        severity: "error",
        title: "High risk of HTTP 400: Pagination not supported",
        body:
          "The estimated GET URL is long enough that ServiceNow may fail building pagination Link headers. " +
          "This often appears after adding more encoded-query conditions or columns — not because JDBC rejected the SQL.",
      });
    } else if (
      urlLen >= URL_CHARS_WARN ||
      queryLen >= QUERY_CHARS_WARN ||
      fieldCount >= FIELD_COUNT_WARN ||
      (allColumns && form.table.trim())
    ) {
      issues.push({
        id: "pagination-not-supported-warn",
        severity: "warn",
        title: "Possible HTTP 400: Pagination not supported",
        body:
          "Long sysparm_query, many sysparm_fields, or returning all columns can push the Table API URL past what ServiceNow can embed in pagination headers when sysparm_limit ≤ 233.",
      });
    }
  }

  if (limit != null && limit > LIMIT_MAX_ROWS) {
    issues.push({
      id: "limit-over-platform",
      severity: "warn",
      title: `sysparm_limit above ${LIMIT_MAX_ROWS.toLocaleString()}`,
      body:
        "ServiceNow’s documented default maximum per Table API GET is 10,000 rows. Higher values are often capped or may time out.",
    });
  }

  if (limit != null && limit > 1_000) {
    issues.push({
      id: "large-page",
      severity: "info",
      title: "Large page size",
      body:
        "Fetching thousands of rows in one REST call is usually slower than JDBC for the same shape. Prefer a smaller sysparm_limit and sysparm_offset loops.",
    });
  }

  if (allColumns && form.table.trim()) {
    issues.push({
      id: "all-columns",
      severity: "info",
      title: "No sysparm_fields — all columns returned",
      body:
        "Wide tables (for example incident) return large JSON payloads. List only the columns you need, matching a selective JDBC SELECT.",
    });
  } else if (fieldCount >= FIELD_COUNT_HIGH) {
    issues.push({
      id: "many-fields",
      severity: "warn",
      title: `${fieldCount} fields in sysparm_fields`,
      body:
        "Each field lengthens the URL and the response. This contributes to pagination-header errors and slower transfers.",
    });
  }

  if (displayAll && (allColumns || fieldCount >= 10)) {
    issues.push({
      id: "display-value-all",
      severity: "warn",
      title: "sysparm_display_value=all with a wide result",
      body:
        "Display values add a second representation per field. Use false or true unless you need both display and stored values.",
    });
  }

  if (offset != null && offset > 0 && needsPaginationHeaders && urlLen >= URL_CHARS_WARN) {
    issues.push({
      id: "offset-long-url",
      severity: "warn",
      title: "sysparm_offset with a long URL",
      body:
        "Pagination parameters are included in Link headers. Combined with a long encoded query, offset pagination is more likely to fail.",
    });
  }

  if (suppress && needsPaginationHeaders === false) {
    // suppress true -> needsPaginationHeaders is false, skip
  }

  if (
    suppress &&
    (queryLen >= QUERY_CHARS_WARN || urlLen >= URL_CHARS_WARN || fieldCount >= FIELD_COUNT_WARN)
  ) {
    issues.push({
      id: "suppress-active",
      severity: "info",
      title: "Pagination headers suppressed",
      body:
        "sysparm_suppress_pagination_header=true avoids Link-header URL limits. You may not get rel=next/prev links; use sysparm_offset manually if you page.",
    });
  }

  if (
    !suppress &&
    needsPaginationHeaders &&
    (queryLen >= QUERY_CHARS_WARN || urlLen >= URL_CHARS_WARN) &&
    limit != null &&
    limit > PAGINATION_HEADER_LIMIT_MAX
  ) {
    issues.push({
      id: "limit-over-233",
      severity: "info",
      title: "sysparm_limit above 233",
      body:
        "ServiceNow documents that limits greater than 233 can avoid the pagination-header URL limit. This does not remove other size or timeout limits.",
    });
  }

  const severityRank: Record<TableApiLimitSeverity, number> = {
    error: 0,
    warn: 1,
    info: 2,
  };
  issues.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );
  return issues;
};

export const tableApiLimitRemedies = (form: TableApiFormState): string[] => {
  const tips: string[] = [];
  if (!form.sysparm_suppress_pagination_header) {
    tips.push("Enable sysparm_suppress_pagination_header for long queries.");
  }
  if (form.sysparm_query.trim().length > QUERY_CHARS_WARN) {
    tips.push("Shorten sysparm_query (fewer ^ conditions or shorter values).");
  }
  if (!form.sysparm_fields.trim() || countSysparmFields(form.sysparm_fields) > FIELD_COUNT_WARN) {
    tips.push("Set sysparm_fields to only the columns you need.");
  }
  const limit = parsePositiveInt(form.sysparm_limit);
  if (
    limit != null &&
    limit <= PAGINATION_HEADER_LIMIT_MAX &&
    !form.sysparm_suppress_pagination_header
  ) {
    tips.push(
      `Try sysparm_limit > ${PAGINATION_HEADER_LIMIT_MAX} or smaller pages with sysparm_offset.`,
    );
  }
  return tips;
};
