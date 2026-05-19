import type { QueryResult } from "./api";

/** Compare-mode / Table API: skip localStorage above this row count (avoids freezes). */
export const MAX_PERSIST_RESULT_ROWS = 500;

/** Skip localStorage when estimated serialized size exceeds this (~2 MB). */
export const MAX_PERSIST_ESTIMATED_BYTES = 2_000_000;

const SAMPLE_ROWS_FOR_ESTIMATE = 200;

export const estimateQueryResultBytes = (result: QueryResult): number => {
  let bytes = result.columns.reduce((n, col) => n + col.length * 2, 0);
  if (result.rows.length === 0) {
    return bytes;
  }

  const sampleSize = Math.min(result.rows.length, SAMPLE_ROWS_FOR_ESTIMATE);
  let sampleBytes = 0;
  for (let i = 0; i < sampleSize; i++) {
    const row = result.rows[i]!;
    for (const cell of row) {
      if (cell === null || cell === undefined) {
        sampleBytes += 4;
      } else if (typeof cell === "number") {
        sampleBytes += 8;
      } else if (typeof cell === "boolean") {
        sampleBytes += 5;
      } else {
        sampleBytes += String(cell).length * 2;
      }
    }
  }

  const avgRowBytes = sampleBytes / sampleSize;
  return Math.ceil(bytes + avgRowBytes * result.rows.length);
};

export const shouldPersistQueryResult = (
  result: QueryResult | null,
): boolean => {
  if (result === null) return true;
  if (result.timing_only === true) return true;
  if (result.row_count <= MAX_PERSIST_RESULT_ROWS) return true;
  return estimateQueryResultBytes(result) <= MAX_PERSIST_ESTIMATED_BYTES;
};

export const filterQueryResultsForPersist = <T extends QueryResult>(
  map: Record<string, T | null>,
): Record<string, T | null> => {
  const out: Record<string, T | null> = {};
  for (const [id, value] of Object.entries(map)) {
    if (shouldPersistQueryResult(value)) {
      out[id] = value;
    }
  }
  return out;
};
