/// <reference lib="webworker" />

import { compareCellValues } from "../lib/compare-cell-values";
import type { CellValue } from "../lib/api";

type SortRequest = {
  rows: CellValue[][];
  columnIndex: number;
  direction: "asc" | "desc";
};

self.onmessage = (event: MessageEvent<SortRequest>) => {
  const { rows, columnIndex, direction } = event.data;
  const indexed = rows.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const cmp = compareCellValues(
      a.row[columnIndex] ?? null,
      b.row[columnIndex] ?? null,
    );
    return direction === "asc" ? cmp : -cmp;
  });
  self.postMessage(indexed.map((entry) => entry.row));
};
