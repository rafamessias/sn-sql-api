import { useCallback, useEffect, useState } from "preact/hooks";
import type { CellValue } from "../lib/api";
import { compareCellValues } from "../lib/compare-cell-values";
import { sortRowsInWorker } from "../lib/sort-rows-worker";

export type SortDir = "asc" | "desc" | null;

export type SortState = {
  columnIndex: number | null;
  direction: SortDir;
};

/** Sort large grids off the main thread to avoid tab freezes. */
const SORT_IN_WORKER_MIN_ROWS = 5_000;

const sortRowsSync = (
  rows: CellValue[][],
  columnIndex: number,
  direction: "asc" | "desc",
): CellValue[][] => {
  const indexed = rows.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const cmp = compareCellValues(
      a.row[columnIndex] ?? null,
      b.row[columnIndex] ?? null,
    );
    return direction === "asc" ? cmp : -cmp;
  });
  return indexed.map((entry) => entry.row);
};

export const useSortedRows = (rows: CellValue[][]) => {
  const [sort, setSort] = useState<SortState>({
    columnIndex: null,
    direction: null,
  });
  const [sortedRows, setSortedRows] = useState<CellValue[][]>(rows);
  const [isSorting, setIsSorting] = useState(false);

  const applySort = useCallback(
    (inputRows: CellValue[][], state: SortState) => {
      if (state.columnIndex === null || state.direction === null) {
        return inputRows;
      }
      return sortRowsSync(inputRows, state.columnIndex, state.direction);
    },
    [],
  );

  useEffect(() => {
    if (sort.columnIndex === null || sort.direction === null) {
      setSortedRows(rows);
      setIsSorting(false);
      return;
    }

    if (rows.length < SORT_IN_WORKER_MIN_ROWS) {
      setSortedRows(applySort(rows, sort));
      setIsSorting(false);
      return;
    }

    let cancelled = false;
    setIsSorting(true);
    sortRowsInWorker(rows, sort.columnIndex, sort.direction)
      .then((next) => {
        if (!cancelled) setSortedRows(next);
      })
      .catch(() => {
        if (!cancelled) setSortedRows(applySort(rows, sort));
      })
      .finally(() => {
        if (!cancelled) setIsSorting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rows, sort, applySort]);

  const toggleSort = (columnIndex: number) => {
    setSort((prev) => {
      if (prev.columnIndex !== columnIndex) {
        return { columnIndex, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { columnIndex, direction: "desc" };
      }
      return { columnIndex: null, direction: null };
    });
  };

  return { sortedRows, sort, toggleSort, isSorting };
};
