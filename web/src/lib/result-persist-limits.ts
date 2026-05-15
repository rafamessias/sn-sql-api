import type { QueryResult } from "./api";

/** Compare-mode / Table API: skip localStorage above this row count (avoids freezes). */
export const MAX_PERSIST_RESULT_ROWS = 500;

export const shouldPersistQueryResult = (
  result: QueryResult | null,
  opts?: { jdbcOnly?: boolean },
): boolean => {
  if (result === null) return true;
  if (opts?.jdbcOnly) return true;
  return result.row_count <= MAX_PERSIST_RESULT_ROWS;
};

export const filterQueryResultsForPersist = <T extends QueryResult>(
  map: Record<string, T | null>,
  opts?: { jdbcOnlyTabIds?: ReadonlySet<string> },
): Record<string, T | null> => {
  const jdbcOnlyTabs = opts?.jdbcOnlyTabIds;
  const out: Record<string, T | null> = {};
  for (const [id, value] of Object.entries(map)) {
    if (
      shouldPersistQueryResult(value, {
        jdbcOnly: jdbcOnlyTabs?.has(id) ?? false,
      })
    ) {
      out[id] = value;
    }
  }
  return out;
};
