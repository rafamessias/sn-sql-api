import { useMemo, useState } from "preact/hooks";
import type { CellValue } from "../lib/api";

export type SortDir = "asc" | "desc" | null;

export type SortState = {
  columnIndex: number | null;
  direction: SortDir;
};

const compareValues = (a: CellValue, b: CellValue): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  const bothNumeric =
    typeof a !== "boolean" &&
    typeof b !== "boolean" &&
    !Number.isNaN(an) &&
    !Number.isNaN(bn) &&
    String(a).trim() !== "" &&
    String(b).trim() !== "";

  if (bothNumeric) {
    return an < bn ? -1 : an > bn ? 1 : 0;
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const useSortedRows = (rows: CellValue[][]) => {
  const [sort, setSort] = useState<SortState>({
    columnIndex: null,
    direction: null,
  });

  const sortedRows = useMemo(() => {
    if (sort.columnIndex === null || sort.direction === null) return rows;
    const indexed = rows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const cmp = compareValues(
        a.row[sort.columnIndex as number],
        b.row[sort.columnIndex as number],
      );
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return indexed.map((entry) => entry.row);
  }, [rows, sort]);

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

  return { sortedRows, sort, toggleSort };
};
