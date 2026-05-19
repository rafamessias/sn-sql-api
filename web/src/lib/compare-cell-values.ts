import type { CellValue } from "./api";

/** Shared by grid sort (main thread and worker). */
export const compareCellValues = (a: CellValue, b: CellValue): number => {
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
