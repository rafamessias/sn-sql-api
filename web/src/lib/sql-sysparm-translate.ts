/**
 * Best-effort translation between a small subset of SQL (ServiceNow JDBC style)
 * and Table API encoded query (`sysparm_query`) plus common `sysparm_*` fields.
 *
 * Full SQL is not expressible as a single encoded query; unsupported constructs
 * surface as `warnings`. Official parameter reference: ServiceNow Table API docs.
 */

export type SqlToSysparmResult = {
  ok: boolean;
  table: string;
  sysparm_query: string;
  sysparm_fields: string | null;
  sysparm_limit: number | null;
  warnings: string[];
};

export type SysparmToSqlResult = {
  ok: boolean;
  sql: string;
  warnings: string[];
};

const stripSqlIdent = (raw: string): string => {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("`") && t.endsWith("`"))
  ) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    return t.slice(1, -1);
  }
  return t;
};

const splitSelectColumns = (selectList: string): { fields: string[] | null; warn: string[] } => {
  const sl = selectList.trim();
  const warn: string[] = [];
  if (!sl || sl === "*") {
    return { fields: null, warn };
  }
  const parts = sl.split(",").map((p) => stripSqlIdent(p.trim()));
  const simple = parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p));
  if (!simple) {
    warn.push(
      "SELECT list contains non-simple columns; only plain identifiers are mapped to sysparm_fields.",
    );
  }
  return { fields: parts.filter(Boolean), warn };
};

type TailParts = {
  whereSql: string | null;
  orderColumn: string | null;
  orderDesc: boolean;
  limit: number | null;
  warnings: string[];
};

const parseSqlTail = (tail: string): TailParts => {
  const warnings: string[] = [];
  let rest = tail.trim();
  let limit: number | null = null;
  const limitM = rest.match(/\blimit\s+(\d+)\s*;?\s*$/i);
  if (limitM) {
    limit = Number.parseInt(limitM[1]!, 10);
    rest = rest.slice(0, limitM.index).trim();
  }

  let orderColumn: string | null = null;
  let orderDesc = false;
  const orderM = rest.match(
    /\border\s+by\s+([^\s,;]+)(?:\s+(asc|desc))?\s*$/i,
  );
  if (orderM) {
    orderColumn = stripSqlIdent(orderM[1]!);
    orderDesc = (orderM[2] ?? "ASC").toUpperCase() === "DESC";
    rest = rest.slice(0, orderM.index).trim();
  }

  let whereSql: string | null = null;
  const whereM = rest.match(/^\s*where\s+([\s\S]+)$/i);
  if (whereM) {
    whereSql = whereM[1]!.trim();
  } else if (rest.length > 0) {
    warnings.push(
      `Could not parse trailing SQL (expected optional WHERE / ORDER BY / LIMIT): ${rest.slice(0, 120)}`,
    );
  }

  return { whereSql, orderColumn, orderDesc, limit, warnings };
};

const sqlLiteralToEncodedValue = (raw: string): { value: string; warn: string[] } => {
  const warn: string[] = [];
  const t = raw.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    const q = t[0]!;
    let inner = t.slice(1, -1);
    if (q === "'") inner = inner.replace(/''/g, "'");
    else inner = inner.replace(/""/g, '"');
    if (inner.includes("^")) {
      warn.push("A string value contains '^' — encoded queries reserve '^' for AND; verify on the instance.");
    }
    return { value: inner, warn };
  }
  if (/^(true|false|null)$/i.test(t)) {
    return { value: t.toLowerCase() === "null" ? "" : t.toLowerCase(), warn };
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return { value: t, warn };
  }
  warn.push(
    `Unrecognized value form "${t.slice(0, 40)}${t.length > 40 ? "…" : ""}" — copied as-is into encoded query.`,
  );
  return { value: t, warn };
};

const whereSqlToEncoded = (whereSql: string): { encoded: string; warnings: string[] } => {
  const warnings: string[] = [];
  const chunks = whereSql.split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const chunk of chunks) {
    const eq = chunk.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/,
    );
    if (!eq) {
      warnings.push(
        `Skipped WHERE fragment (only simple \`col = value\` supported): ${chunk.slice(0, 80)}`,
      );
      continue;
    }
    const col = eq[1]!;
    const { value, warn } = sqlLiteralToEncodedValue(eq[2]!);
    warnings.push(...warn);
    parts.push(`${col}=${value}`);
  }
  return { encoded: parts.join("^"), warnings };
};

/**
 * Maps a narrow `SELECT … FROM … WHERE … ORDER BY … LIMIT …` shape to Table API parameters.
 */
export const sqlToSysparm = (sql: string): SqlToSysparmResult => {
  const warnings: string[] = [];
  const normalized = sql.trim().replace(/;+\s*$/g, "");
  const m = normalized.match(
    /^\s*select\s+([\s\S]+?)\s+from\s+([^\s;]+)([\s\S]*)$/i,
  );
  if (!m) {
    return {
      ok: false,
      table: "",
      sysparm_query: "",
      sysparm_fields: null,
      sysparm_limit: null,
      warnings: [
        "Could not parse SQL (expected: SELECT … FROM table …).",
      ],
    };
  }

  const selectList = m[1]!;
  const table = stripSqlIdent(m[2]!);
  const tail = m[3] ?? "";
  const { fields, warn: fieldWarn } = splitSelectColumns(selectList);
  warnings.push(...fieldWarn);

  const tailParts = parseSqlTail(tail);
  warnings.push(...tailParts.warnings);

  let sysparm_query = "";
  if (tailParts.whereSql) {
    const { encoded, warnings: w2 } = whereSqlToEncoded(tailParts.whereSql);
    warnings.push(...w2);
    sysparm_query = encoded;
  }

  if (tailParts.orderColumn) {
    const ob = tailParts.orderDesc
      ? `ORDERBYDESC${tailParts.orderColumn}`
      : `ORDERBY${tailParts.orderColumn}`;
    sysparm_query = sysparm_query ? `${sysparm_query}^${ob}` : ob;
  }

  return {
    ok: true,
    table,
    sysparm_query,
    sysparm_fields: fields && fields.length > 0 ? fields.join(",") : null,
    sysparm_limit: tailParts.limit,
    warnings,
  };
};

const parseEncodedOrderClauses = (
  encoded: string,
): { filter: string; orderSql: string | null; warnings: string[] } => {
  const warnings: string[] = [];
  const segments = encoded.split("^").map((s) => s.trim()).filter(Boolean);
  const filters: string[] = [];
  let orderSql: string | null = null;
  for (const seg of segments) {
    const descM = seg.match(/^ORDERBYDESC(.+)$/i);
    if (descM) {
      orderSql = `ORDER BY ${stripSqlIdent(descM[1]!)} DESC`;
      continue;
    }
    const ascM = seg.match(/^ORDERBY(.+)$/i);
    if (ascM) {
      orderSql = `ORDER BY ${stripSqlIdent(ascM[1]!)} ASC`;
      continue;
    }
    filters.push(seg);
  }
  return { filter: filters.join(" AND "), orderSql, warnings };
};

const encodedConditionToSql = (part: string): { sql: string | null; warnings: string[] } => {
  const warnings: string[] = [];
  const idx = part.indexOf("=");
  if (idx <= 0) {
    warnings.push(
      `Could not map fragment to SQL equality (expected field=value): ${part.slice(0, 80)}`,
    );
    return { sql: null, warnings };
  }
  const field = part.slice(0, idx).trim();
  const value = part.slice(idx + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    warnings.push(`Skipped non-simple field name: ${field}`);
    return { sql: null, warnings };
  }
  if (value === "true" || value === "false") {
    return { sql: `${field} = ${value.toUpperCase()}`, warnings };
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return { sql: `${field} = ${value}`, warnings };
  }
  const escaped = value.replace(/'/g, "''");
  return { sql: `${field} = '${escaped}'`, warnings };
};

/**
 * Builds a readable `SELECT *` for the Table API side — not guaranteed to run on JDBC.
 */
export const sysparmToSql = (input: {
  table: string;
  sysparm_query: string;
  sysparm_limit?: number | null;
  sysparm_fields?: string | null;
}): SysparmToSqlResult => {
  const warnings: string[] = [];
  const table = stripSqlIdent(input.table.trim());
  if (!table) {
    return { ok: false, sql: "", warnings: ["Table name is empty."] };
  }

  const encoded = input.sysparm_query.trim();
  const { filter, orderSql, warnings: wEnc } = encoded
    ? parseEncodedOrderClauses(encoded)
    : { filter: "", orderSql: null, warnings: [] as string[] };
  warnings.push(...wEnc);

  const fieldList =
    input.sysparm_fields && input.sysparm_fields.trim()
      ? input.sysparm_fields
          .split(",")
          .map((c) => stripSqlIdent(c.trim()))
          .filter(Boolean)
          .join(", ")
      : "*";

  const whereParts: string[] = [];
  if (filter) {
    for (const piece of filter.split(/\s+AND\s+/i).map((p) => p.trim()).filter(Boolean)) {
      const { sql, warnings: w } = encodedConditionToSql(piece);
      warnings.push(...w);
      if (sql) whereParts.push(sql);
    }
  }

  const lines: string[] = [`SELECT ${fieldList}`, `FROM ${table}`];
  if (whereParts.length) {
    lines.push(`WHERE ${whereParts.join(" AND ")}`);
  }
  if (orderSql) {
    lines.push(orderSql);
  }
  const lim =
    input.sysparm_limit != null &&
    Number.isFinite(input.sysparm_limit) &&
    input.sysparm_limit > 0
      ? Math.floor(input.sysparm_limit)
      : null;
  if (lim != null) {
    lines.push(`LIMIT ${lim}`);
  }

  warnings.push(
    "This SQL is an approximation for readability — JDBC may require different quoting or functions than the Table API encoded query.",
  );

  return { ok: true, sql: `${lines.join("\n")};`, warnings };
};
