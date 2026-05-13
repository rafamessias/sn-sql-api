export type BuilderSpec = {
  table: string;
  columns: string[];
  expressions: string[];
  where: string;
  orderBy: string;
  orderDir: "ASC" | "DESC";
  limit: number | null;
};

const isSimpleIdentifier = (value: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

const quoteIfNeeded = (value: string): string =>
  isSimpleIdentifier(value) ? value : `"${value.replace(/"/g, '""')}"`;

/**
 * Splits a free-form textarea (one expression per line, semicolons and commas
 * also accepted as separators) into an array of trimmed, non-empty expressions.
 * Pass-through as-is otherwise — these are written by the user and live verbatim
 * in the SELECT clause.
 */
export const parseExpressions = (raw: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\n;]+/)
    .map((entry) => entry.trim().replace(/,\s*$/, ""))
    .filter((entry) => entry.length > 0);
};

export const buildSelectSql = (spec: BuilderSpec): string => {
  const table = spec.table.trim();
  if (!table) return "";

  const columnParts = spec.columns.map(quoteIfNeeded);
  const expressionParts = spec.expressions
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const projection = [...columnParts, ...expressionParts];
  const columnList = projection.length ? projection.join(", ") : "*";

  const lines: string[] = [
    `SELECT ${columnList}`,
    `FROM ${quoteIfNeeded(table)}`,
  ];

  const where = spec.where.trim();
  if (where) lines.push(`WHERE ${where}`);

  const orderColumn = spec.orderBy.trim();
  if (orderColumn) {
    lines.push(`ORDER BY ${quoteIfNeeded(orderColumn)} ${spec.orderDir}`);
  }

  if (spec.limit != null && spec.limit > 0) {
    lines.push(`LIMIT ${spec.limit}`);
  }

  return `${lines.join("\n")};`;
};
