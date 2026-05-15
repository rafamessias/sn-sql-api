import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { CellValue, QueryResult } from "../lib/api";
import { tabularToCsv } from "../lib/csv";
import { useSortedRows } from "../hooks/use-sorted-rows";
import { useVirtualList } from "../hooks/use-virtual-list";
import { cn } from "../lib/cn";

const ROW_HEIGHT = 32;
/** Sticky header row inside the scroll area (`min-h-[2.5rem]`). */
const SCROLL_GRID_HEADER_REM = 2.5;
/** Default cap on visible data rows before vertical scroll (non-expanded). */
export const RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS = 25;
const MIN_COL_WIDTH = 160;
/** Fixed track for the leading row-number column. */
const ROW_NUM_COL = "minmax(2.75rem, 3.25rem)";
/** Minimum `ch` width for a data column (header + padding fudge). */
const MIN_DATA_COL_CH = 12;
/** Hard cap on measured string length when turning it into `ch` (pathological cells). */
const MAX_CH_FOR_MIN = 400;
/** Up to this many data columns, leftover row width is split with weighted `fr` so wide panels show more text. */
const MAX_COLS_FOR_WEIGHTED_FR = 14;
/** Cap on `fr` weight so one column cannot starve the rest. */
const MAX_FR_WEIGHT = 200;

type ResultsTableProps = {
  result: QueryResult;
  resultsExpanded?: boolean;
  onToggleResultsExpanded?: () => void;
  /** Shown next to the status dot; omit when a title is shown outside the table. */
  resultLabel?: string;
  /**
   * Max data rows in the scroll viewport before scrolling (sticky column header counts toward height).
   * Omit for `RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS`. Pass `null` for no cap.
   * Ignored when `resultsExpanded` is true.
   */
  maxVisibleDataRows?: number | null;
};

const cellSearchText = (value: CellValue): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

const buildGridTemplate = (columns: string[], rows: CellValue[][]): string => {
  if (columns.length === 0) return "";
  const useFr = columns.length <= MAX_COLS_FOR_WEIGHTED_FR;

  const tracks = columns.map((name, colIndex) => {
    let maxChars = name.length;
    for (const row of rows) {
      const len = cellSearchText(row[colIndex] ?? null).length;
      if (len > maxChars) maxChars = len;
    }
    const contentCh = Math.min(
      Math.max(maxChars + 2, MIN_DATA_COL_CH),
      MAX_CH_FOR_MIN,
    );
    const minTrack = `max(${MIN_COL_WIDTH}px, ${contentCh}ch)`;
    if (useFr) {
      const fr = Math.max(1, Math.min(maxChars + 2, MAX_FR_WEIGHT));
      return `minmax(${minTrack}, ${fr}fr)`;
    }
    return `minmax(${minTrack}, ${contentCh}ch)`;
  });
  return `${ROW_NUM_COL} ${tracks.join(" ")}`;
};

const rowMatchesFilter = (row: CellValue[], q: string): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return row.some((cell) => cellSearchText(cell).toLowerCase().includes(needle));
};

const renderCell = (value: CellValue) => {
  if (value === null || value === undefined) {
    return <span class="italic text-subtle">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span class="text-info">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span class="text-warn">{value}</span>;
  }
  return <span>{String(value)}</span>;
};

const SortGlyph = ({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) => {
  if (!active || dir === null) {
    return (
      <span aria-hidden="true" class="text-subtle">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" class="text-accent">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
};

export const ResultsTable = ({
  result,
  resultsExpanded = false,
  onToggleResultsExpanded,
  resultLabel,
  maxVisibleDataRows,
}: ResultsTableProps) => {
  const dataRowCap = resultsExpanded
    ? undefined
    : maxVisibleDataRows === null
      ? undefined
      : maxVisibleDataRows !== undefined
        ? maxVisibleDataRows
        : RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS;

  const scrollAreaMaxHeight =
    dataRowCap != null && dataRowCap > 0
      ? `calc(${SCROLL_GRID_HEADER_REM}rem + ${dataRowCap * ROW_HEIGHT}px)`
      : undefined;

  const { sortedRows, sort, toggleSort } = useSortedRows(result.rows);
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    setFilterText("");
  }, [result]);

  const filteredRows = useMemo(
    () => sortedRows.filter((row) => rowMatchesFilter(row, filterText)),
    [sortedRows, filterText],
  );

  const { containerRef, startIndex, endIndex, paddingTop, totalHeight } =
    useVirtualList<HTMLDivElement>({
      totalItems: filteredRows.length,
      rowHeight: ROW_HEIGHT,
    });

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = 0;
  }, [filterText, result, containerRef]);

  const visible = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex],
  );

  const gridTemplate = useMemo(
    () => buildGridTemplate(result.columns, result.rows),
    [result.columns, result.rows],
  );

  const useWeightedFr =
    result.columns.length > 0 &&
    result.columns.length <= MAX_COLS_FOR_WEIGHTED_FR;

  const handleDownloadCsv = useCallback(() => {
    const csv = tabularToCsv(result.columns, filteredRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `query-results-${stamp}.csv`;
    anchor.rel = "noopener";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result.columns, filteredRows]);

  if (result.columns.length === 0) {
    return (
      <div class="flex h-48 items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted">
        Query executed. No columns returned.
      </div>
    );
  }

  return (
    <div
      class={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface",
        resultsExpanded && "h-full w-full min-h-0 min-w-0",
      )}
    >
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          {resultLabel != null && resultLabel.trim() !== "" ? (
            <div class="flex shrink-0 items-center gap-2 font-mono text-[11px] text-subtle">
              <span class="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <span class="text-accent">{resultLabel}</span>
            </div>
          ) : null}
          <div class="min-w-[12rem] max-w-full flex-1 sm:max-w-md">
            <label class="sr-only" for="results-grid-filter">
              Search result rows
            </label>
            <input
              id="results-grid-filter"
              type="search"
              class="input font-mono text-[12px]"
              placeholder="Search rows (any column)…"
              value={filterText}
              onInput={(e) => setFilterText((e.target as HTMLInputElement).value)}
              autoComplete="off"
              spellcheck={false}
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
          {filterText.trim() ? (
            <span class="badge">
              <span class="text-subtle">showing</span>
              <span class="text-text">{filteredRows.length.toLocaleString()}</span>
              <span class="text-subtle">/</span>
              <span class="text-muted">{sortedRows.length.toLocaleString()}</span>
            </span>
          ) : null}
          <span class="badge">
            <span class="text-subtle">rows</span>
            <span class="text-text">{result.row_count.toLocaleString()}</span>
          </span>
          <span class="badge">
            <span class="text-subtle">cols</span>
            <span class="text-text">{result.columns.length}</span>
          </span>
          <button
            type="button"
            class="btn"
            onClick={handleDownloadCsv}
            disabled={sortedRows.length === 0}
            title={
              sortedRows.length === 0
                ? "No rows to export"
                : "Download current table (sorted, filtered) as a .csv file"
            }
          >
            Export CSV
          </button>
          {onToggleResultsExpanded ? (
            <button
              type="button"
              class="btn"
              onClick={onToggleResultsExpanded}
              aria-expanded={resultsExpanded}
              aria-label={
                resultsExpanded
                  ? "Collapse results panel"
                  : "Expand results over the editor at full viewport width"
              }
              title={
                resultsExpanded
                  ? "Dock the results below the editor again"
                  : "Float results over the editor (full column height, full viewport width for wide tables)"
              }
            >
              {resultsExpanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        class="relative isolate min-h-0 flex-1 overflow-auto bg-code"
        style={
          scrollAreaMaxHeight != null
            ? { maxHeight: scrollAreaMaxHeight }
            : undefined
        }
      >
        <div class="inline-block min-w-full align-top">
          <div
            role="row"
            class={cn(
              "sticky top-0 z-20 grid w-full border-b border-border bg-surface-2",
              !useWeightedFr && "justify-start",
            )}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div
              role="columnheader"
              class="flex min-h-[2.5rem] items-center justify-end border-r border-border bg-surface-2 px-2 py-2 font-mono text-[12px] text-muted tabular-nums"
              aria-label="Row number"
            >
              #
            </div>
            {result.columns.map((column, index) => {
              const active = sort.columnIndex === index;
              return (
                <button
                  type="button"
                  key={`${column}-${index}`}
                  onClick={() => toggleSort(index)}
                  class={cn(
                    "flex min-h-[2.5rem] min-w-0 items-center justify-between gap-2 border-r border-border bg-surface-2 px-3 py-2 text-left font-mono text-[12px]",
                    "transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                    active ? "text-accent" : "text-text",
                  )}
                  aria-sort={
                    active && sort.direction
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <span class="min-w-0 flex-1 truncate">{column}</span>
                  <SortGlyph active={active} dir={active ? sort.direction : null} />
                </button>
              );
            })}
          </div>

          {sortedRows.length === 0 ? (
            <div class="flex h-32 items-center justify-center text-sm text-muted">
              No rows returned.
            </div>
          ) : filteredRows.length === 0 ? (
            <div class="flex h-32 items-center justify-center px-4 text-center text-sm text-muted">
              No rows match “{filterText.trim()}”. Clear the search to see all rows.
            </div>
          ) : (
            <div class="relative z-0" style={{ height: totalHeight }}>
              <div style={{ transform: `translateY(${paddingTop}px)` }}>
                {visible.map((row, offset) => {
                  const rowIndex = startIndex + offset;
                  return (
                    <div
                      role="row"
                      key={rowIndex}
                      class={cn(
                        "grid w-full border-b border-border/60 font-mono text-[12.5px] text-text transition-colors",
                        !useWeightedFr && "justify-start",
                        rowIndex % 2 === 1 ? "bg-bg/40" : "bg-code",
                        "hover:bg-accent-dim/40",
                      )}
                      style={{
                        gridTemplateColumns: gridTemplate,
                        height: ROW_HEIGHT,
                      }}
                    >
                      <div
                        role="cell"
                        class="flex items-center justify-end overflow-hidden border-r border-border/40 px-2 font-mono text-[12.5px] tabular-nums text-muted"
                        aria-label={`Row ${(rowIndex + 1).toLocaleString()}`}
                      >
                        {(rowIndex + 1).toLocaleString()}
                      </div>
                      {row.map((cell, columnIndex) => (
                        <div
                          role="cell"
                          key={columnIndex}
                          class="flex min-w-0 items-center overflow-hidden border-r border-border/40 px-3"
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          <span class="min-w-0 truncate">{renderCell(cell)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
